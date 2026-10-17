-- TODO の状態変更日時を保存する（既存データは削除しません）
-- tasks.created_at は既存の作成日時カラムをそのまま使用します。
alter table public.tasks
  add column if not exists completed_at timestamptz,
  add column if not exists deleted_at timestamptz;

-- 既に完了済みの古い TODO の完了時刻は不明なので、無理に埋めません。
-- アプリ更新後のチェック操作では completed_at が保存され、
-- 削除操作では行を削除せず deleted_at が保存されます。
