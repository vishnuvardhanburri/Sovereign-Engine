export async function sendTelegramMessage(input: {
  botToken?: string | null
  chatId?: string | null
  text: string
}) {
  if (!input.botToken || !input.chatId) {
    return { delivered: false, reason: 'telegram not configured' as const }
  }

  const response = await fetch(
    `https://api.telegram.org/bot${input.botToken}/sendMessage`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    }
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Telegram send failed: ${body}`)
  }

  return { delivered: true as const }
}

