import { createClient } from 'npm:@supabase/supabase-js@2';

const origin = 'https://kazuma-hara.github.io';
const headers = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Vary': 'Origin',
};
const respond = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
  if (req.headers.get('origin') !== origin) return respond({ error: 'Origin not allowed' }, 403);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return respond({ error: 'ログインが必要です' }, 401);
  const projectUrl = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!projectUrl || !publicKey || !geminiKey) return respond({ error: 'サーバー設定が未完了です' }, 503);

  const client = createClient(projectUrl, publicKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await client.auth.getUser(authHeader.slice(7));
  if (authError || !user) return respond({ error: '認証に失敗しました' }, 401);

  let date: string;
  try {
    const body = await req.json();
    date = body.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) {
      return respond({ error: '日付が不正です' }, 400);
    }
  } catch {
    return respond({ error: '入力を確認してください' }, 400);
  }

  const { data: entry, error: readError } = await client.from('diary_entries')
    .select('content').eq('entry_date', date).maybeSingle();
  if (readError) return respond({ error: '日記を読み込めませんでした' }, 500);
  const diary = entry?.content?.trim() ?? '';
  if (!diary) return respond({ error: '日記を入力してから要約してください' }, 400);
  if (diary.length > 10000) return respond({ error: '日記が長すぎます（最大1万文字）' }, 400);

  const { data: scores, error: scoreError } = await client.from('daily_scores')
    .select('category,score').eq('entry_date', date);
  if (scoreError) return respond({ error: 'スコアを読み込めませんでした' }, 500);
  const scoreText = (scores ?? []).map(s => s.category + ': ' + s.score + '/10').join(', ');

  const prompt = [
    '次の日記を日本語で2文以内・100字以内に中立的に要約してください。',
    '事実にない推測、診断、励まし、アドバイス、過度な肯定は書かないでください。',
    '個人の一日を振り返るための概要として簡潔に書いてください。',
    '日付: ' + date,
    '任意のスコア: ' + scoreText,
    '日記本文:\n' + diary,
  ].join('\n');
  const ai = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 350, temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(25000),
  }).catch(() => null);
  if (!ai) return respond({ error: 'AIサービスに接続できませんでした' }, 502);
  if (!ai.ok) {
    // Never return service key or raw provider error body.
    return respond({ error: ai.status === 429 ? '無料枠の利用制限に達しました' : 'AI生成に失敗しました (' + ai.status + ')' }, 502);
  }
  const result = await ai.json();
  const summary = (result.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim().slice(0, 400);
  if (!summary) return respond({ error: 'AIから要約を受け取れませんでした' }, 502);
  const { error: updateError } = await client.from('diary_entries')
    .update({ ai_summary: summary }).eq('entry_date', date);
  if (updateError) return respond({ error: '要約の保存に失敗しました' }, 500);
  return respond({ summary });
});
