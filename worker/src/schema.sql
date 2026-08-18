CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  plan TEXT DEFAULT 'free',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shops (
  shop_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  shop_name TEXT,
  domain TEXT,
  url TEXT,
  active_products INTEGER,
  scan_interval_hours INTEGER DEFAULT 24,
  last_scan_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(email)
);

CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tts_pid TEXT,
  shop_id TEXT,
  shop_name TEXT,
  name TEXT,
  url TEXT,
  image_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(email),
  FOREIGN KEY (shop_id) REFERENCES shops(shop_id)
);

CREATE TABLE IF NOT EXISTS product_skus (
  sku_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  tts_sku_id TEXT,
  name TEXT,
  option_names TEXT,
  price INTEGER,
  discount TEXT,
  stock INTEGER,
  max_order INTEGER,
  min_order INTEGER,
  is_buyable INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  sold_count INTEGER,
  review_count INTEGER,
  rating REAL,
  price INTEGER,
  stock INTEGER,
  sold_delta INTEGER,
  review_delta INTEGER,
  stock_delta INTEGER,
  raw_json TEXT,
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE TABLE IF NOT EXISTS sku_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id TEXT NOT NULL,
  snapshot_id INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  stock INTEGER,
  stock_delta INTEGER,
  FOREIGN KEY (sku_id) REFERENCES product_skus(sku_id),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  feedback_id TEXT,
  rating INTEGER,
  message TEXT,
  variant_name TEXT,
  review_time INTEGER,
  review_time_text TEXT,
  user_name TEXT,
  is_anonymous INTEGER,
  image_urls TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, feedback_id),
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_product ON snapshots(product_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_sku_snapshots ON sku_snapshots(sku_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, review_time DESC);
CREATE INDEX IF NOT EXISTS idx_shops_user ON shops(user_id);
CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id);
