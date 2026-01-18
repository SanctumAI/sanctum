import { ReactNode } from 'react'

interface ChatContainerProps {
  children: ReactNode
  header?: ReactNode
  sidebar?: ReactNode
}

export function ChatContainer({ children, header, sidebar }: ChatContainerProps) {
  return (
    <div className="h-screen flex flex-col bg-surface">
      {header && (
        <header className="border-b border-border bg-surface-raised shrink-0">
          {header}
        </header>
      )}
      <div className="flex-1 flex overflow-hidden">
        {sidebar && (
          <aside className="w-64 border-r border-border bg-surface-raised shrink-0 hidden md:block overflow-y-auto">
            {sidebar}
          </aside>
        )}
        <main className="flex-1 flex flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  )
}
