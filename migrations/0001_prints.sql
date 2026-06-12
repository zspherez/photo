-- Print metadata for the print-sales gallery.
-- One row per Cloudinary image, keyed by its public_id.
CREATE TABLE IF NOT EXISTS prints (
  public_id   TEXT PRIMARY KEY,
  title       TEXT,
  description TEXT,
  price       TEXT,
  -- JSON array of { "label": string, "price": string } size/price options.
  sizes       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
