-- 日付単位の食事メモ（朝・昼・夜は分けず、自由記述のみ）
-- 既存の日記・AI要約・スコアを変更せずに列を追加します。
alter table public.diary_entries
  add column if not exists meal_memo text not null default '';
