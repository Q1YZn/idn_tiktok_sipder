// 共享 TS 类型定义 (shared/types.ts)

export interface User {
  email: string;
  plan?: string;
  created_at?: string;
}

export interface Shop {
  shop_id: string;
  user_id?: string;
  shop_name?: string | null;
  domain?: string | null;
  url?: string | null;
  active_products?: number | null;
  scan_interval_hours?: number;
  last_scan_at?: string | null;
  created_at?: string | null;
}

export interface RatingBreakdown {
  rate: number | null;
  totalReviews: number | null;
}

export interface ProductSku {
  sku_id: string;
  product_id: string;
  tts_sku_id?: string | null;
  name?: string | null;
  option_names?: string[] | string | null;
  price?: number | null;
  discount?: string | null;
  stock?: number | null;
  max_order?: number | null;
  min_order?: number | null;
  is_buyable?: boolean | number;
  created_at?: string | null;
}

export interface ParsedVariantSku {
  productID: string;
  ttsSKUID?: string | null;
  name?: string | null;
  optionNames?: string[];
  price?: number | null;
  discount?: string | null;
  stock?: number | null;
  maxOrder?: number | null;
  minOrder?: number | null;
  isBuyable?: boolean;
}

export interface ParsedVariants {
  skus: ParsedVariantSku[];
  [key: string]: unknown;
}

export interface ScrapedProduct {
  productID: string;
  ttsPID?: string | null;
  shopID?: string | null;
  shopName?: string | null;
  name?: string | null;
  url?: string | null;
  price?: number | null;
  soldCount?: number | null;
  reviewCount?: number | null;
  rating?: number | null;
  stock?: number | null;
  imageMain?: string | null;
  images?: string[];
  ratingBreakdown?: RatingBreakdown[];
  reviewPositivePct?: string | null;
  variants?: ParsedVariants;
  capturedAt?: string;
  shop_id?: string;
  [key: string]: unknown;
}

export interface Product {
  product_id: string;
  user_id?: string;
  tts_pid?: string | null;
  shop_id?: string | null;
  shop_name?: string | null;
  name?: string | null;
  url?: string | null;
  image_url?: string | null;
  created_at?: string | null;
  // 最新快照字段
  sold_count?: number | null;
  review_count?: number | null;
  rating?: number | null;
  price?: number | null;
  stock?: number | null;
  captured_at?: string | null;
  sold_delta?: number | null;
  review_delta?: number | null;
  stock_delta?: number | null;
  // raw_json 合并字段
  images?: string[] | null;
  imageMain?: string | null;
  ratingBreakdown?: RatingBreakdown[] | null;
  reviewPositivePct?: string | null;
  [key: string]: unknown;
}

export interface Snapshot {
  id?: number;
  product_id: string;
  captured_at: string;
  sold_count?: number | null;
  review_count?: number | null;
  rating?: number | null;
  price?: number | null;
  stock?: number | null;
  sold_delta?: number | null;
  review_delta?: number | null;
  stock_delta?: number | null;
  raw_json?: string | null;
}

export interface SkuSnapshot {
  id?: number;
  sku_id: string;
  snapshot_id: number;
  captured_at: string;
  stock?: number | null;
  stock_delta?: number | null;
  option_names?: string | null;
  price?: number | null;
}

export interface NormalizedReview {
  feedback_id: string | number | null;
  rating: number | null;
  message: string | null;
  variant_name?: string | null;
  review_time?: number | null;
  review_time_text?: string | null;
  user_name?: string | null;
  is_anonymous?: boolean | number;
  image_urls?: string[];
}

export interface Review {
  id: number;
  product_id: string;
  feedback_id: string | null;
  rating: number | null;
  message: string | null;
  variant_name?: string | null;
  review_time?: number | null;
  review_time_text?: string | null;
  user_name?: string | null;
  is_anonymous?: number | null;
  image_urls?: string | null;
  created_at?: string | null;
}

export interface DailyStatRow {
  date: string;
  daily_sold: number | null;
  daily_review: number | null;
  daily_stock_delta: number | null;
  cum_sold: number | null;
  cum_review: number | null;
  rating: number | null;
  price: number | null;
}

export interface HealthResponse {
  ok: boolean;
  ts: string;
}

export interface ProductsResponse {
  products: Product[];
}

export interface ShopsResponse {
  shops: Shop[];
}

export interface ProductDetailResponse {
  product: Product;
}

export interface StatsResponse {
  product_id: string;
  days: number;
  series: DailyStatRow[];
}

export interface SkusResponse {
  product_id: string;
  skus: SkuSnapshot[];
}

export interface ReviewsResponse {
  product_id: string;
  total: number;
  reviews: Review[];
}

export interface SubmitReviewsResponse {
  ok: boolean;
  inserted: number;
}
