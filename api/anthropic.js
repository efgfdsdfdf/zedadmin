// api/anthropic.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { messages, model, max_tokens, system, temperature } = req.body;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-5-20250929',
        max_tokens: max_tokens || 1000,
        temperature: temperature || 0.7,
        system: system || '',
        messages: messages.map(({ role, content }) => ({
          role: role === 'assistant' ? 'assistant' : 'user',
          content,
        })),
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'API error');

    res.status(200).json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}