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

const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

Deno.serve(async (req) => {
  try {
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

    const body = await req.json().catch(() => null);
    const from = body?.start_date;
    const to = body?.end_date;
    if (!validDate(from) || !validDate(to)) return respond({ error: '期間の日付を確認してください' }, 400);
    const days = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;
    if (days < 2 || days > 90) return respond({ error: '分析期間は2〜90日以内で指定してください' }, 400);

    const [{ data: diaryRows, error: diaryError }, { data: scoreRows, error: scoreError }] = await Promise.all([
      client.from('diary_entries').select('entry_date,content')
        .eq('user_id', user.id).gte('entry_date', from).lte('entry_date', to).order('entry_date'),
      client.from('daily_scores').select('entry_date,category,score')
        .eq('user_id', user.id).gte('entry_date', from).lte('entry_date', to).order('entry_date'),
    ]);
    if (diaryError || scoreError) return respond({ error: '期間中の記録を読み込めませんでした' }, 500);

    const diaries = (diaryRows ?? []).filter(x => typeof x.content === 'string' && x.content.trim());
    const scores = (scoreRows ?? []).filter(x => Number.isFinite(x.score) && x.score >= 1 && x.score <= 10);
    if (!diaries.length && !scores.length) return respond({ error: '指定期間に日記・スコアの記録がありません' }, 400);

    const categories = ['体調・気分','睡眠','食事','ワーク','生活タスク','運動','勉強'];
    const stats = categories.map(category => {
      const matches = scores.filter(x => x.category === category);
      if (!matches.length) return category + ': 未入力';
      const vals = matches.map(x => x.score);
      const avg = (vals.reduce((sum, x) => sum + x, 0) / vals.length).toFixed(1);
      return category + ': ' + matches.length + '日記録、平均' + avg +
        '点、最小' + Math.min(...vals) + '点、最大' + Math.max(...vals) + '点';
    });
    const byDate = new Map<string, { diary?: string; scores: Record<string, number> }>();
    const ensure = (date: string) => {
      if (!byDate.has(date)) byDate.set(date, { scores: {} });
      return byDate.get(date)!;
    };
    for (const row of diaries) ensure(row.entry_date).diary = row.content.trim().slice(0, 700);
    for (const row of scores) ensure(row.entry_date).scores[row.category] = row.score;
    const log = [...byDate.entries()].sort((a,b) => a[0].localeCompare(b[0]))
      .map(([date, entry]) => date + ' | 日記: ' + (entry.diary || '未入力') +
        ' | スコア: ' + (Object.entries(entry.scores).map(([k,v]) => k + '=' + v).join(', ') || '未入力'))
      .join('\n');
    const prompt = [
      'あなたは個人の記録の傾向を客観的に分析するアシスタントです。',
      '指定期間の日記と7項目スコアを比較して、日本語で「全体の傾向」「スコアの変化」「日記に繰り返し現れるテーマ」の3つの見出しで分析してください。',
      '日々の出来事の単純な羅列ではなく、繰り返し・変化・高低・関連して見える動きを具体的な記録や数字で示してください。',
      '未入力は未実施やゼロ点として扱わず、記録が少ないときは傾向の確かさに限界があると明記してください。',
      '別々の要因の因果関係は断定せず、共起は「同じ日に見られた」など慎重に表現してください。',
      '推測による診断、励まし、改善提案、次の行動の指示は不要です。強い断言を避け、500字以内にしてください。',
      '範囲: ' + from + '〜' + to + '（' + days + '日間）',
      '日記記録日数: ' + diaries.length + '日、スコア記録日数: ' +
        new Set(scores.map(x => x.entry_date)).size + '日',
      '項目ごとの客観的な集計:',
      stats.join('\n'),
      '日別の記録（日記は各日先頭700文字まで）:',
      log,
    ].join('\n\n');

    const ai = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1000, temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(35000),
    }).catch(() => null);
    if (!ai) return respond({ error: 'AIサービスに接続できませんでした' }, 502);
    if (!ai.ok) return respond({ error: ai.status === 429
      ? '無料枠の利用制限に達しました' : 'AI分析に失敗しました (' + ai.status + ')' }, 502);
    const result = await ai.json();
    const report = (result.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? '').join('').trim().slice(0, 2500);
    if (!report) return respond({ error: 'AIから分析結果を受け取れませんでした' }, 502);

    const { error: saveError } = await client.from('period_analyses').upsert({
      user_id: user.id, start_date: from, end_date: to, report,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,start_date,end_date' });
    if (saveError) return respond({ error: '分析結果の保存に失敗しました。期間分析用のSQLが適用されているか確認してください' }, 500);
    return respond({ report, recorded_days: byDate.size, range_days: days });
  } catch {
    return respond({ error: '分析中にエラーが発生しました' }, 500);
  }
});
