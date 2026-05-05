export async function generateSubjectLines(input: {
  company?: string | null
  angle: 'pattern' | 'pain' | 'authority'
}): Promise<string[]> {
  const companyFragment = input.company ? `${input.company}` : 'your team'
  const base = input.angle === 'pain'
    ? `Struggling with ${companyFragment}?`
    : input.angle === 'authority'
    ? `A better way for ${companyFragment}`
    : `A fresh outbound pattern for ${companyFragment}`

  return [
    base,
    input.angle === 'authority' ? `Proof that works for ${companyFragment}` : `A small improvement for ${companyFragment}`,
    `Quick question for ${companyFragment}`,
  ]
}
