// v3.11 — Composants partagés pour l'affichage de l'espace disque
import { fmtSize } from '../api.js'


// Niveau de remplissage → couleur (vert / jaune / orange / rouge)
function diskColor(usedPct) {
  if (usedPct == null) return 'var(--muted)'
  if (usedPct < 70)  return 'var(--success)'
  if (usedPct < 85)  return 'var(--warning)'
  if (usedPct < 95)  return '#fb923c'   // orange foncé
  return 'var(--danger)'
}


/**
 * Badge compact "✓ 412 Go libres / 2 To (46%)" à droite du label.
 * - `disk` est l'objet retourné par /api/validate-path → disk
 * - `validity` permet d'afficher les erreurs basiques (préfixe, dossier, etc.)
 */
export function DiskBadge({ disk, validity, projection }) {
  // Pas de validity → rien
  if (!validity) return null

  // Erreurs basiques en priorité
  if (!validity.valid_prefix)  return <span style={s.err}>✗ Préfixe invalide</span>
  if (!validity.exists)        return <span style={s.err}>✗ Introuvable</span>
  if (!validity.is_dir)        return <span style={s.err}>✗ Pas un dossier</span>
  if (!validity.readable)      return <span style={s.warn}>⚠ Non lisible</span>

  // Ok mais infos disque indisponibles
  if (!disk || disk.error === 'timeout') {
    return (
      <span style={{ ...s.ok, color: disk?.stale ? 'var(--warning)' : 'var(--success)' }}>
        ✓ OK{disk?.error === 'timeout' && ' (espace dispo : timeout)'}
      </span>
    )
  }
  if (!disk.total_bytes) {
    return <span style={s.ok}>✓ OK</span>
  }

  const color = diskColor(disk.used_pct)
  const free  = fmtSize(disk.free_bytes)
  const total = fmtSize(disk.total_bytes)

  // Projection post-sync (target uniquement, quand bytesToCopy connu)
  let projEl = null
  if (projection != null && disk.free_bytes != null) {
    const after = disk.free_bytes - projection
    const ok    = after >= 0
    projEl = (
      <span style={{ fontSize: 10, color: ok ? 'var(--muted)' : 'var(--danger)',
                     marginLeft: 8, fontWeight: ok ? 400 : 600 }}>
        {ok
          ? `· après sync : ${fmtSize(after)} libres`
          : `⚠ MANQUE ${fmtSize(-after)} après sync`}
      </span>
    )
  }

  return (
    <span style={{ ...s.base, color }}>
      ✓ {free} libres / {total} ({disk.used_pct}%)
      {disk.stale && <span style={s.staleHint}> · cache</span>}
      {projEl}
    </span>
  )
}


/**
 * Barre de remplissage fine sous l'input.
 * Affichée uniquement si on a des infos disque valides.
 */
export function DiskBar({ disk }) {
  if (!disk || disk.used_pct == null) return null
  const pct = Math.min(100, Math.max(0, disk.used_pct))
  const color = diskColor(disk.used_pct)
  return (
    <div style={{
      height: 3, width: '100%', background: 'var(--bg)', borderRadius: 2,
      overflow: 'hidden', marginTop: 2,
    }}>
      <div style={{
        height: '100%', width: `${pct}%`, background: color,
        transition: 'width .3s ease, background-color .3s ease',
      }} />
    </div>
  )
}


/**
 * Bandeau d'alerte "source et cible sur le même volume".
 * À utiliser dans TabScanSync au niveau du composant parent.
 */
export function SameVolumeWarning({ sourceDisk, targetDisk }) {
  if (!sourceDisk || !targetDisk) return null
  if (!sourceDisk.mount_point || !targetDisk.mount_point) return null
  if (sourceDisk.mount_point !== targetDisk.mount_point) return null
  return (
    <div style={{
      marginTop: 10, padding: '10px 14px', background: '#422006',
      borderLeft: '3px solid var(--warning)', borderRadius: 6,
      fontSize: 12, color: '#fcd34d', lineHeight: 1.5,
    }}>
      <strong>⚠ Source et cible sur le même volume</strong> ({sourceDisk.mount_point}, {sourceDisk.fstype}).
      <br />Si ce disque tombe, les deux copies seront perdues. Pour une vraie sauvegarde,
      choisis une cible sur un disque ou un NAS différent.
    </div>
  )
}


const s = {
  base: { fontSize: 11, fontFamily: 'var(--mono)', whiteSpace: 'nowrap' },
  err:  { color: 'var(--danger)',  fontSize: 11 },
  warn: { color: 'var(--warning)', fontSize: 11 },
  ok:   { color: 'var(--success)', fontSize: 11 },
  staleHint: { fontSize: 9, color: 'var(--muted)', fontStyle: 'italic' },
}
