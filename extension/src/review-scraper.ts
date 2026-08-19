import { NormalizedReview } from '../../shared/types';

const UA =
 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const GRAPHQL_URL = 'https://gql.tokopedia.com/graphql/productReviewList';

const QUERY = `query productReviewList($productID: String!, $page: Int!, $limit: Int!, $sortBy: String, $filterBy: String) {
 productrevGetProductReviewList(productID: $productID, page: $page, limit: $limit, sortBy: $sortBy, filterBy: $filterBy) {
 productID
 list {
 id: feedbackID
 variantName
 message
 productRating
 reviewCreateTime
 reviewCreateTimestamp
 isReportable
 isAnonymous
 imageAttachments {
 attachmentID
 imageThumbnailUrl
 imageUrl
 __typename
 }
 user { userID fullName image url __typename }
 stats { key formatted count __typename }
 badRatingReasonFmt
 __typename
 }
 hasNext
 totalReviews
 __typename
 }
}`;

function toNum(v: any): number | null {
 if (v === undefined || v === null || v === '') return null;
 const n = Number(v);
 return Number.isFinite(n) ? n : null;
}

/** 归一化为评论行 */
export function normalizeReview(r: any): NormalizedReview {
 const imgs = (r.imageAttachments || [])
 .map((a: any) => a.imageUrl || a.imageThumbnailUrl)
 .filter(Boolean);
 return {
 feedback_id: r.id ?? null,
 rating: toNum(r.productRating),
 message: r.message ?? null,
 variant_name: r.variantName ?? null,
 review_time: toNum(r.reviewCreateTime),
 review_time_text: r.reviewCreateTimestamp ?? null,
 user_name: r.isAnonymous ? null : (r.user?.fullName ?? null),
 is_anonymous: !!r.isAnonymous,
 image_urls: imgs.length ? imgs : undefined,
 };
}

/** 抓取一页评论（增强日志） */
async function fetchPage(
 productID: string,
 { page, limit, sortBy }: { page: number; limit: number; sortBy: string }
): Promise<any> {
 const body = [
 {
 operationName: 'productReviewList',
 variables: { productID: String(productID), page, limit, sortBy, filterBy: '' },
 query: QUERY,
 },
 ];
 let lastErr: any;
 for (let i = 0; i <= 2; i++) {
 try {
 const url = GRAPHQL_URL;
 console.log(`[Review] 请求评论接口 page=${page} productID=${productID} attempt=${i + 1}`);
 const res = await fetch(url, {
 method: 'POST',
 headers: {
 'User-Agent': UA,
 accept: '*/*',
 'content-type': 'application/json',
 origin: 'https://www.tokopedia.com',
 referer: 'https://www.tokopedia.com/',
 'x-tkpd-pdpb': '0',
 'x-version': '5f60895',
 'x-price-center': 'false',
 'bd-device-id': '',
 'x-source': 'tokopedia-lite',
 'x-device': 'desktop',
 'x-tkpd-lite-service': 'zeus',
 },
 body: JSON.stringify(body),
 });
 const status = res.status;
 const text = await res.text();
 console.log(`[Review] 接口响应 status=${status} bodyLength=${text.length}`);
 if (!res.ok) {
 console.error(`[Review] 评论接口 HTTP 异常 status=${status} body=${text.slice(0, 200)}`);
 throw new Error(`评论接口 HTTP ${status}`);
 }
 let json: any;
 try {
 json = JSON.parse(text);
 } catch (parseErr) {
 console.error(`[Review] 评论接口 JSON 解析失败: ${parseErr} body=${text.slice(0, 300)}`);
 throw new Error('评论接口返回非 JSON');
 }
 const data = json[0]?.data?.productrevGetProductReviewList ?? null;
 if (!data) {
 console.warn(`[Review] 评论接口返回空数据结构 jsonRoot=${JSON.stringify(json).slice(0, 200)}`);
 }
 return data;
 } catch (e) {
 lastErr = e;
 console.warn(`[Review] 评论接口请求失败 attempt=${i + 1} err=${e}`);
 if (i < 2) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
 }
 }
 console.error(`[Review] 评论接口最终失败 productID=${productID} lastErr=${lastErr}`);
 throw lastErr;
}

/**
 * 抓取商品评论（自动翻页到 hasNext=false 或 maxPages 上限）
 */
export async function scrapeReviews(
 productID: string,
 {
 page = 1,
 limit = 10,
 sortBy = 'informative_score desc',
 maxPages = 2,
 }: {
 page?: number;
 limit?: number;
 sortBy?: string;
 maxPages?: number;
 } = {}
): Promise<{ reviews: NormalizedReview[]; total: number | null; hasNext: boolean }> {
 const reviews: NormalizedReview[] = [];
 let curPage = Math.max(1, page);
 let total: number | null = null;
 let hasNext = true;

 while (hasNext && curPage <= maxPages) {
 const data = await fetchPage(productID, { page: curPage, limit, sortBy });
 if (!data || !Array.isArray(data.list)) break;
 total = data.totalReviews ?? total;
 reviews.push(...data.list.map(normalizeReview));
 hasNext = data.hasNext === true;
 curPage++;
 if (hasNext && curPage <= maxPages) {
 await new Promise((r) => setTimeout(r, 300));
 }
 }

 return { reviews, total: total ?? reviews.length, hasNext };
}
