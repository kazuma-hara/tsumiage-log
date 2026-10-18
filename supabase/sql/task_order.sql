-- TODOの並び順をPC・スマホで共有するための列
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS sort_order integer;

-- 既存TODOには作成日時順の初期位置を付与します。
-- 再実行しても、すでに並び替えた順序は変更されません。
WITH ordered AS (
  SELECT id,
         (row_number() OVER (PARTITION BY user_id ORDER BY created_at ASC NULLS LAST, id ASC) - 1)::integer AS position
  FROM public.tasks
)
UPDATE public.tasks AS t
SET sort_order = ordered.position
FROM ordered
WHERE t.id = ordered.id
  AND t.sort_order IS NULL;
