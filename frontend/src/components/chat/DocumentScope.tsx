import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface Ontology {
  id: string
  name: string
  description: string
  entity_types: string[]
  relationship_types: string[]
}

interface DocumentScopeProps {
  selectedDocuments: string[]
  onToggle: (docId: string) => void
  apiBase?: string
  compact?: boolean
}

export function DocumentScope({
  selectedDocuments,
  onToggle,
  apiBase = 'http://localhost:8000',
  compact = false,
}: DocumentScopeProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [ontologies, setOntologies] = useState<Ontology[]>([])
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, openUpward: false })

  useEffect(() => {
    const fetchOntologies = async () => {
      setLoading(true)
      try {
        const res = await fetch(`${apiBase}/ingest/ontologies`)
        if (!res.ok) throw new Error('Failed to fetch ontologies')
        const data = await res.json()
        setOntologies(data.ontologies || [])
      } catch {
        setOntologies([
          {
            id: 'bitcoin_technical',
            name: 'Bitcoin Technical',
            description: 'Technical concepts, protocols, and algorithms',
            entity_types: ['Concept', 'Protocol', 'Algorithm'],
            relationship_types: ['USES', 'ENABLES', 'COMPOSED_OF'],
          },
          {
            id: 'human_rights',
            name: 'Human Rights',
            description: 'Claims, actors, events, and legal instruments',
            entity_types: ['Claim', 'Actor', 'Event'],
            relationship_types: ['SUPPORTED_BY', 'PARTICIPATES_IN'],
          },
        ])
      } finally {
        setLoading(false)
      }
    }

    fetchOntologies()
  }, [apiBase])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const updatePosition = () => {
        if (buttonRef.current) {
          const rect = buttonRef.current.getBoundingClientRect()
          const dropdownHeight = 280 // estimated max height
          const spaceBelow = window.innerHeight - rect.bottom
          const spaceAbove = rect.top
          const openUpward = spaceBelow < dropdownHeight && spaceAbove > spaceBelow

          setDropdownPosition({
            top: openUpward ? rect.top - 6 : rect.bottom + 6,
            left: rect.left,
            openUpward,
          })
        }
      }

      updatePosition()
      window.addEventListener('scroll', updatePosition, true)
      window.addEventListener('resize', updatePosition)

      return () => {
        window.removeEventListener('scroll', updatePosition, true)
        window.removeEventListener('resize', updatePosition)
      }
    }
  }, [isOpen])

  const selectedCount = selectedDocuments.length

  const dropdownContent = isOpen ? (
    <div
      ref={dropdownRef}
      className="fixed w-64 bg-surface-raised border border-border rounded-xl shadow-lg z-[9999] flex flex-col animate-fade-in-scale"
      style={{
        top: dropdownPosition.openUpward ? 'auto' : `${dropdownPosition.top}px`,
        bottom: dropdownPosition.openUpward ? `${window.innerHeight - dropdownPosition.top}px` : 'auto',
        left: `${dropdownPosition.left}px`,
        maxHeight: `${dropdownPosition.openUpward ? dropdownPosition.top - 16 : window.innerHeight - dropdownPosition.top - 16}px`,
      }}
    >
      <div className="px-3 py-2.5 border-b border-border shrink-0">
        <h4 className="text-xs font-semibold text-text">Knowledge Bases</h4>
        <p className="text-[10px] text-text-muted mt-0.5">
          Select sources to include in context
        </p>
      </div>

      <div className="overflow-y-auto flex-1 min-h-0">
        {loading ? (
          <div className="p-4 text-center">
            <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto" />
          </div>
        ) : ontologies.length === 0 ? (
          <div className="p-4 text-center text-text-muted text-xs">No sources available</div>
        ) : (
          <div className="p-1.5">
            {ontologies.map((ontology) => {
              const isSelected = selectedDocuments.includes(ontology.id)
              return (
                <button
                  key={ontology.id}
                  onClick={() => onToggle(ontology.id)}
                  className={`w-full text-left p-2.5 rounded-lg mb-1 last:mb-0 transition-all ${
                    isSelected
                      ? 'bg-accent/10 border border-accent/30'
                      : 'hover:bg-surface-overlay border border-transparent'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div
                      className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                        isSelected ? 'bg-accent border-accent' : 'border-border'
                      }`}
                    >
                      {isSelected && (
                        <svg className="w-2.5 h-2.5 text-accent-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-text">{ontology.name}</p>
                      <p className="text-[10px] text-text-muted mt-0.5 line-clamp-1">
                        {ontology.description}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {ontology.entity_types.slice(0, 2).map((type) => (
                          <span
                            key={type}
                            className="text-[9px] bg-surface-overlay text-text-muted px-1.5 py-0.5 rounded"
                          >
                            {type}
                          </span>
                        ))}
                        {ontology.entity_types.length > 2 && (
                          <span className="text-[9px] text-text-muted">
                            +{ontology.entity_types.length - 2}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {selectedCount > 0 && (
        <div className="px-3 py-2 border-t border-border shrink-0">
          <button
            onClick={() => selectedDocuments.forEach((id) => onToggle(id))}
            className="text-[10px] text-text-muted hover:text-text transition-colors"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  ) : null

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all hover-scale active-press ${
          selectedCount > 0
            ? 'bg-accent text-accent-text shadow-sm'
            : 'text-text-secondary hover:text-text hover:bg-surface-overlay border border-transparent hover:border-border'
        }`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        {compact ? null : 'Docs'}
        {selectedCount > 0 && (
          <span className={`text-[10px] rounded px-1 min-w-[1rem] text-center ${
            selectedCount > 0 ? 'bg-accent-text/20 text-accent-text' : ''
          }`}>
            {selectedCount}
          </span>
        )}
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {typeof document !== 'undefined' && createPortal(dropdownContent, document.body)}
    </div>
  )
}
