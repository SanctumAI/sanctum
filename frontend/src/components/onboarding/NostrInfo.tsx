import { useState } from 'react'
import { ChevronDown, Check, ExternalLink } from 'lucide-react'

export function NostrInfo() {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="mt-6">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-center gap-2 w-full text-sm text-text-muted hover:text-text transition-colors py-2"
      >
        <span>What is Nostr?</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-4 text-sm text-text-secondary animate-fade-in-up">
          <div className="bg-surface-overlay rounded-xl p-4 border-l-4 border-accent">
            <h3 className="font-semibold text-text mb-2">What is Nostr?</h3>
            <p className="leading-relaxed">
              Nostr is a decentralized protocol for social networking and identity.
              Unlike traditional logins, your identity isn't controlled by any company — you own your keys.
            </p>
          </div>

          <div className="bg-surface-overlay rounded-xl p-4 border-l-4 border-accent">
            <h3 className="font-semibold text-text mb-2">What is NIP-07?</h3>
            <p className="leading-relaxed mb-3">
              NIP-07 is a standard that lets websites request your Nostr public key from a browser extension. This means:
            </p>
            <ul className="space-y-2">
              <li className="flex items-start gap-2">
                <Check className="w-5 h-5 text-success shrink-0 mt-0.5" />
                <span>No passwords to remember</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-5 h-5 text-success shrink-0 mt-0.5" />
                <span>No email verification needed</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-5 h-5 text-success shrink-0 mt-0.5" />
                <span>Your identity is cryptographically secure</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-5 h-5 text-success shrink-0 mt-0.5" />
                <span>You control your own keys</span>
              </li>
            </ul>
          </div>

          <div className="bg-surface-overlay rounded-xl p-4 border-l-4 border-accent">
            <h3 className="font-semibold text-text mb-2">How it works</h3>
            <ol className="space-y-2 list-decimal list-inside">
              <li>Install a Nostr signing extension (we recommend Alby)</li>
              <li>Click "Connect with Nostr" above</li>
              <li>Approve the connection in your extension</li>
              <li>You're in!</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  )
}

export function NostrExtensionLinks() {
  return (
    <div className="space-y-2">
      <p className="text-text-muted text-sm mb-3">
        Don't have a Nostr extension? Get one here:
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        <a
          href="https://getalby.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay border border-border rounded-lg text-sm text-text hover:border-accent hover:text-accent transition-all"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
          Alby
          <ExternalLink className="w-3 h-3 opacity-50" />
        </a>
        <a
          href="https://github.com/nicolgit/nos2x"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay border border-border rounded-lg text-sm text-text hover:border-accent hover:text-accent transition-all"
        >
          nos2x
          <ExternalLink className="w-3 h-3 opacity-50" />
        </a>
      </div>
    </div>
  )
}
