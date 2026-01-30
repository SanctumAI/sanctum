import { Message } from '../components/chat/ChatMessage'

export type ExportFormat = 'md' | 'txt'

interface ExportTranslations {
  defaultTitle: string
  roleUser: string
  roleAssistant: string
  footer: string
  exportedOn: string
}

interface ExportOptions {
  messages: Message[]
  format: ExportFormat
  title?: string
  translations: ExportTranslations
  instanceName?: string
}

function formatTimestamp(date?: Date): string {
  if (!date) return ''
  return date.toLocaleString()
}

export function generateExport({ messages, format, title, translations, instanceName = 'Sanctum' }: ExportOptions): string {
  const timestamp = new Date().toLocaleString()
  const exportTitle = title || translations.defaultTitle
  const footerText = translations.footer.replace('{{instanceName}}', instanceName)
  const exportedOnText = translations.exportedOn.replace('{{timestamp}}', timestamp)

  if (format === 'md') {
    let content = `# ${exportTitle}\n\n`
    content += `*${exportedOnText}*\n\n---\n\n`

    messages.forEach((message) => {
      const role = message.role === 'user' ? `**${translations.roleUser}**` : `**${translations.roleAssistant}**`
      const time = message.timestamp ? ` *(${formatTimestamp(message.timestamp)})*` : ''

      content += `### ${role}${time}\n\n`

      if (message.role === 'user') {
        // User messages are plain text, wrap in blockquote
        content += `> ${message.content.split('\n').join('\n> ')}\n\n`
      } else {
        // Assistant messages may contain markdown, preserve as-is
        content += `${message.content}\n\n`
      }

      content += `---\n\n`
    })

    content += `\n*${footerText}*`
    return content
  }

  // Plain text format
  let content = `${exportTitle}\n`
  content += `${'='.repeat(exportTitle.length)}\n\n`
  content += `${exportedOnText}\n\n`
  content += `${'─'.repeat(40)}\n\n`

  messages.forEach((message) => {
    const role = message.role === 'user' ? translations.roleUser : translations.roleAssistant
    const time = message.timestamp ? ` (${formatTimestamp(message.timestamp)})` : ''

    content += `${role}${time}:\n`
    content += `${message.content}\n\n`
    content += `${'─'.repeat(40)}\n\n`
  })

  content += `\n${footerText}`
  return content
}

export function downloadExport(options: ExportOptions): void {
  const content = generateExport(options)
  const extension = options.format === 'md' ? 'md' : 'txt'
  const mimeType = options.format === 'md' ? 'text/markdown' : 'text/plain'
  const filename = `sanctum-chat-${Date.now()}.${extension}`

  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}
