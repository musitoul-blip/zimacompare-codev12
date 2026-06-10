// v3.12 — Panneau d'édition du fichier .zimaignore
import { useState, useEffect, useMemo, useRef } from 'react'
import { api, fmtNum } from '../api.js'


// ── Petit composant : compteur live en bas de l'éditeur ────────────────
function PatternMeter({ text, maxBytes }) {
  const stats = useMemo(() => {
    const lines = text.split('\n')
    let active = 0, comments = 0, blanks = 0, negations = 0, wildcards = 0
    for (const raw of lines) {
      const l = raw.trim()
      if (!l) { blanks++; continue }
      if (l.startsWith('#')) { comments++; continue }
      active++
      if (l.startsWith('!')) negations++
      if (/[*?[]/.test(l)) wildcards++
    }
    return { active, comments, blanks, negations, wildcards }
  }, [text])

  const bytes = new TextEncoder().encode(text).length
  const pctBytes = Math.min(100, (bytes / maxBytes) * 100)
  const sizeWarn = bytes > maxBytes * 0.85

  return (
    <div style={{ display:'flex', gap:14, fontSize:11, color:'var(--muted)',
                   alignItems:'center', flexWrap:'wrap', marginTop:8 }}>
      <span><strong style={{ color:'var(--text)' }}>{fmtNum(stats.active)}</strong> pattern{stats.active > 1 ? 's' : ''} actif{stats.active > 1 ? 's' : ''}</span>
      <span style={{ opacity:.6 }}>·</span>
      <span>{stats.comments} commentaire{stats.comments > 1 ? 's' : ''}</span>
      {stats.negations > 0 && <>
        <span style={{ opacity:.6 }}>·</span>
        <span style={{ color:'#fb923c' }}>{stats.negations} négation{stats.negations > 1 ? 's' : ''}</span>
      </>}
      {stats.wildcards > 0 && <>
        <span style={{ opacity:.6 }}>·</span>
        <span style={{ color:'var(--accent)' }}>{stats.wildcards} avec wildcard</span>
      </>}
      <span style={{ flex:1 }} />
      <span style={{ color: sizeWarn ? 'var(--warning)' : 'var(--muted)' }}>
        {fmtNum(bytes)} / {fmtNum(maxBytes)} octets ({pctBytes.toFixed(0)}%)
      </span>
    </div>
  )
}


// ── Coloration syntaxique très légère pour l'éditeur ───────────────────
function HighlightOverlay({ text }) {
  // On colorise en HTML positionné par-dessus le textarea (transparent).
  const html = useMemo(() => {
    const lines = text.split('\n')
    return lines.map((raw, i) => {
      const trimmed = raw.trim()
      let cls = 'pat'
      if (!trimmed) cls = 'blank'
      else if (trimmed.startsWith('#')) cls = 'comment'
      else if (trimmed.startsWith('!')) cls = 'neg'
      else if (/[*?[]/.test(trimmed)) cls = 'wild'
      // Préserver les espaces et caractères spéciaux
      const escaped = raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      return `<div class="line ${cls}">${escaped || '&#8203;'}</div>`
    }).join('')
  }, [text])

  return (
    <div className="hl-overlay" dangerouslySetInnerHTML={{ __html: html }} />
  )
}


// ── Composant principal ────────────────────────────────────────────────
export default function IgnorePanel() {
  const [data,      setData]      = useState(null)
  const [content,   setContent]   = useState('')
  const [dirty,     setDirty]     = useState(false)
  const [busy,      setBusy]      = useState(false)
  const [msg,       setMsg]       = useState(null)
  const [testRoot,  setTestRoot]  = useState('')
  const [testRes,   setTestRes]   = useState(null)
  const [collapsed, setCollapsed] = useState(true)
  const [paths,     setPaths]     = useState({ disks:[], network:[] })
  const [status,    setStatus]    = useState(null)

  const taRef = useRef(null)
  const overlayRef = useRef(null)

  // Chargement lazy : on n'appelle l'API qu'à l'ouverture du panneau
  useEffect(() => {
    if (collapsed) return
    api.ignoreGet().then(d => {
      setData(d)
      setContent(d.content)
      setDirty(false)
    }).catch(e => notify(`Erreur de chargement : ${e.message}`, false))
    api.discover().then(setPaths).catch(() => {})
    api.status().then(setStatus).catch(() => {})
  }, [collapsed])

  function notify(text, ok=true) {
    setMsg({ text, ok })
    setTimeout(() => setMsg(null), 4000)
  }

  function onTextChange(v) {
    setContent(v)
    setDirty(v !== data?.content)
  }

  // Sync scroll entre textarea et overlay coloré
  function syncScroll() {
    if (taRef.current && overlayRef.current) {
      overlayRef.current.scrollTop = taRef.current.scrollTop
      overlayRef.current.scrollLeft = taRef.current.scrollLeft
    }
  }

  async function doSave() {
    try {
      setBusy(true)
      const d = await api.ignorePut(content)
      setData(d)
      setContent(d.content)
      setDirty(false)
      notify(`✓ Sauvegardé — ${d.patterns_active} patterns actifs`)
    } catch (e) { notify(e.message, false) }
    finally { setBusy(false) }
  }

  async function doReset() {
    if (!confirm('Restaurer le fichier .zimaignore aux valeurs par défaut ?\n' +
                 'Tes patterns personnalisés seront perdus.')) return
    try {
      setBusy(true)
      const d = await api.ignoreReset()
      setData(d)
      setContent(d.content)
      setDirty(false)
      notify('✓ Patterns par défaut restaurés')
    } catch (e) { notify(e.message, false) }
    finally { setBusy(false) }
  }

  async function doTest() {
    if (!testRoot) return notify('Choisis un dossier à tester', false)
    try {
      setBusy(true)
      setTestRes(null)
      // On envoie le contenu courant (peut être différent du fichier sauvé)
      const r = await api.ignoreTest({
        root: testRoot,
        content: dirty ? content : null,
        max_samples: 100,
      })
      setTestRes(r)
    } catch (e) { notify(e.message, false) }
    finally { setBusy(false) }
  }

  // ── Avertissement scan en cours ─────────────────────────────────────
  const scanRunning = status && !['IDLE','ERROR'].includes(status.app_state)

  // ── Suggestions de chemins pour le test ─────────────────────────────
  const testSuggestions = [...new Set([
    ...(paths?.disks   || []),
    ...(paths?.network || []),
  ])]

  if (collapsed) {
    return (
      <div className="card" style={{ cursor:'pointer' }} onClick={() => setCollapsed(false)}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <span style={{ fontWeight:600, fontSize:13 }}>🚫 Filtres .zimaignore</span>
            <span style={{ marginLeft:12, fontSize:12, color:'var(--muted)' }}>
              Patterns d'exclusion appliqués aux scans et au nettoyage
            </span>
          </div>
          <span style={{ fontSize:11, color:'var(--accent)' }}>▾ Ouvrir</span>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <style>{`
        .ignore-editor-wrap {
          position: relative;
          font-family: var(--mono, ui-monospace, SFMono-Regular, Consolas, monospace);
          font-size: 13px;
          line-height: 1.5;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 6px;
          overflow: hidden;
        }
        .ignore-editor-wrap textarea,
        .ignore-editor-wrap .hl-overlay {
          margin: 0;
          padding: 12px 14px;
          border: 0;
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          white-space: pre;
          word-wrap: normal;
          overflow: auto;
        }
        .ignore-editor-wrap textarea {
          position: relative;
          width: 100%;
          min-height: 260px;
          background: transparent;
          color: transparent;
          caret-color: var(--text);
          resize: vertical;
          outline: none;
        }
        .ignore-editor-wrap textarea::selection {
          background: rgba(96,165,250,0.35);
          color: transparent;
        }
        .ignore-editor-wrap .hl-overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
          color: var(--text);
        }
        .hl-overlay .line          { min-height: 1.5em; }
        .hl-overlay .line.comment  { color: var(--muted); font-style: italic; }
        .hl-overlay .line.neg      { color: #fb923c; }
        .hl-overlay .line.wild     { color: var(--accent, #6fffb0); }
        .hl-overlay .line.blank    { color: transparent; }
      `}</style>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                     marginBottom:12, flexWrap:'wrap', gap:8 }}>
        <div>
          <span style={{ fontWeight:600, fontSize:13 }}>🚫 Filtres .zimaignore</span>
          {dirty && <span style={{ marginLeft:10, fontSize:10, padding:'2px 7px',
                                    background:'var(--warning)', color:'#000',
                                    borderRadius:3, letterSpacing:'.05em', fontWeight:700 }}>
            MODIFIÉ
          </span>}
        </div>
        <button onClick={() => setCollapsed(true)} className="btn-ghost"
                style={{ fontSize:11, padding:'4px 10px' }}>▴ Réduire</button>
      </div>

      <p style={{ fontSize:12, color:'var(--muted)', lineHeight:1.55, marginBottom:14 }}>
        Patterns au format gitignore. Appliqués aux scans <strong>et</strong> au
        nettoyage. Syntaxe : <code>*.tmp</code> (extension),
        <code>{' **/cache/'}</code> (dossier à toute profondeur),
        <code>{' /build/'}</code> (racine seulement),
        <code>{' !important.tmp'}</code> (négation).
      </p>

      {scanRunning && (
        <div style={{ padding:'10px 14px', background:'#422006',
                      borderLeft:'3px solid var(--warning)', borderRadius:6,
                      fontSize:12, color:'#fcd34d', marginBottom:12 }}>
          ⚠ Un scan est en cours. Les modifications s'appliqueront aux scans suivants.
        </div>
      )}

      {msg && (
        <div style={{ padding:'8px 12px', borderRadius:6, marginBottom:12, fontSize:12,
                       background: msg.ok ? '#14532d' : '#450a0a',
                       color:     msg.ok ? '#86efac' : '#fca5a5' }}>
          {msg.text}
        </div>
      )}

      {/* Éditeur */}
      <div className="ignore-editor-wrap">
        <div ref={overlayRef} className="hl-overlay">
          <HighlightOverlay text={content} />
        </div>
        <textarea
          ref={taRef}
          value={content}
          onChange={e => onTextChange(e.target.value)}
          onScroll={syncScroll}
          spellCheck={false}
          placeholder="# Ajoute tes patterns ici&#10;*.tmp&#10;**/cache/"
        />
      </div>

      <PatternMeter text={content} maxBytes={data?.max_bytes || 65536} />

      <div style={{ display:'flex', gap:8, marginTop:14, flexWrap:'wrap' }}>
        <button className="btn-primary" onClick={doSave} disabled={busy || !dirty}>
          💾 Sauvegarder
        </button>
        <button className="btn-ghost" onClick={doReset} disabled={busy}
                style={{ fontSize:12, padding:'8px 14px' }}>
          ↺ Restaurer les défauts
        </button>
        <button className="btn-ghost" onClick={() => {
          setContent(data?.content || '')
          setDirty(false)
        }} disabled={busy || !dirty}
                style={{ fontSize:12, padding:'8px 14px' }}>
          ✕ Annuler les modifs
        </button>
      </div>

      {/* Test sur un dossier réel */}
      <div style={{ marginTop:24, paddingTop:16, borderTop:'1px dashed var(--border)' }}>
        <h4 style={{ fontSize:12, fontWeight:600, marginBottom:10,
                      letterSpacing:'.05em', textTransform:'uppercase',
                      color:'var(--muted)' }}>
          🔍 Tester sur un dossier
        </h4>
        <div style={{ display:'flex', gap:8, alignItems:'stretch', flexWrap:'wrap' }}>
          <input type="text" value={testRoot} list="ignore-test-paths"
                 onChange={e => setTestRoot(e.target.value)}
                 placeholder="/disks/… ou /network/…"
                 style={{ flex:1, minWidth:240, fontFamily:'var(--mono)' }} />
          <datalist id="ignore-test-paths">
            {testSuggestions.map(p => <option key={p} value={p} />)}
          </datalist>
          <button className="btn-primary" onClick={doTest} disabled={busy || !testRoot}
                  style={{ fontSize:12 }}>
            Tester {dirty && '(non sauvegardé)'}
          </button>
        </div>

        {testRes && (
          <div style={{ marginTop:14, padding:12, background:'var(--bg)',
                         borderRadius:6, border:'1px solid var(--border)' }}>
            <div style={{ display:'flex', gap:18, fontSize:12, flexWrap:'wrap' }}>
              <span><strong style={{ color:'var(--warning)' }}>{fmtNum(testRes.ignored_count)}</strong> entrée{testRes.ignored_count > 1 ? 's' : ''} ignorée{testRes.ignored_count > 1 ? 's' : ''}</span>
              <span style={{ opacity:.6 }}>·</span>
              <span><strong style={{ color:'var(--success)' }}>{fmtNum(testRes.kept_count)}</strong> conservée{testRes.kept_count > 1 ? 's' : ''}</span>
              {testRes.truncated && <>
                <span style={{ opacity:.6 }}>·</span>
                <span style={{ color:'var(--warning)' }}>
                  ⚠ Tronqué à {fmtNum(testRes.scan_limit)} entrées
                </span>
              </>}
            </div>
            {testRes.samples?.length > 0 && (
              <details style={{ marginTop:10 }}>
                <summary style={{ fontSize:11, color:'var(--muted)', cursor:'pointer',
                                  letterSpacing:'.05em', textTransform:'uppercase' }}>
                  Aperçu ({testRes.samples.length} entrée{testRes.samples.length > 1 ? 's' : ''})
                </summary>
                <pre style={{ marginTop:8, padding:10, background:'#0a0e0a',
                              borderRadius:4, fontSize:11, color:'var(--muted)',
                              maxHeight:200, overflowY:'auto',
                              fontFamily:'var(--mono)' }}>
                  {testRes.samples.join('\n')}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
