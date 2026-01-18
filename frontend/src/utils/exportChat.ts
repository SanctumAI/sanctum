import { Message } from '../components/chat/ChatMessage'

export type ExportFormat = 'md' | 'txt'

interface ExportOptions {
  messages: Message[]
  format: ExportFormat
  title?: string
}

function formatTimestamp(date?: Date): string {
  if (!date) return ''
  return date.toLocaleString()
}

export function generateExport({ messages, format, title = 'Chat Export' }: ExportOptions): string {
  const timestamp = new Date().toLocaleString()

  if (format === 'md') {
    let content = `# ${title}\n\n`
    content += `*Exported on ${timestamp}*\n\n---\n\n`

    messages.forEach((message) => {
      const role = message.role === 'user' ? '**You**' : '**Assistant**'
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

    content += `\n*Exported from Sanctum RAG*`
    return content
  }

  // Plain text format
  let content = `${title}\n`
  content += `${'='.repeat(title.length)}\n\n`
  content += `Exported on ${timestamp}\n\n`
  content += `${'─'.repeat(40)}\n\n`

  messages.forEach((message) => {
    const role = message.role === 'user' ? 'You' : 'Assistant'
    const time = message.timestamp ? ` (${formatTimestamp(message.timestamp)})` : ''

    content += `${role}${time}:\n`
    content += `${message.content}\n\n`
    content += `${'─'.repeat(40)}\n\n`
  })

  content += `\nExported from Sanctum RAG`
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
