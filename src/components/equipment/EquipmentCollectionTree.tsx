import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderPlus, FolderTree, Pencil, Save, Trash2, X } from 'lucide-react'
import type { EquipmentCollectionRoot, EquipmentLibraryEntry, EquipmentLibraryFolder } from '@/types/market'

export type EquipmentCollectionSelection =
  | { kind: 'all' }
  | { kind: 'root'; root: EquipmentCollectionRoot; folderId?: string }

interface RootOption {
  id: EquipmentCollectionRoot
  label: string
}

interface Props {
  roots: RootOption[]
  folders: EquipmentLibraryFolder[]
  entries: EquipmentLibraryEntry[]
  selection: EquipmentCollectionSelection
  allLabel?: string
  labels: { collapse: string; expand: string; newFolder: string; rename: string; delete: string }
  readOnly?: boolean
  onSelect: (selection: EquipmentCollectionSelection) => void
  onCreate: (root: EquipmentCollectionRoot, name: string, parentId?: string) => Promise<void>
  onRename: (folderId: string, name: string) => Promise<void>
  onDelete: (folder: EquipmentLibraryFolder) => Promise<void>
  onToggle: (folder: EquipmentLibraryFolder) => Promise<void>
}

type Editor = { mode: 'create'; root: EquipmentCollectionRoot; parentId?: string; name: string }
  | { mode: 'rename'; folderId: string; name: string }

export function EquipmentCollectionTree({ roots, folders, entries, selection, allLabel, labels, readOnly = false, onSelect, onCreate, onRename, onDelete, onToggle }: Props) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [busy, setBusy] = useState(false)
  const [collapsedRoots, setCollapsedRoots] = useState<Set<EquipmentCollectionRoot>>(() => new Set())
  const itemFolders = useMemo(() => folders.filter((folder) => folder.scope === 'items'), [folders])
  const selectedFolder = selection.kind === 'root' && selection.folderId
    ? itemFolders.find((folder) => folder.id === selection.folderId)
    : undefined

  const submit = async () => {
    if (!editor?.name.trim()) return
    setBusy(true)
    try {
      if (editor.mode === 'create') await onCreate?.(editor.root, editor.name.trim(), editor.parentId)
      else await onRename?.(editor.folderId, editor.name.trim())
      setEditor(null)
    } finally {
      setBusy(false)
    }
  }

  const beginCreate = () => {
    if (readOnly) return
    if (selection.kind !== 'root') return
    setEditor({
      mode: 'create',
      root: selectedFolder?.collectionRoot || selection.root,
      parentId: selectedFolder?.id,
      name: '',
    })
  }

  const toggleRoot = (root: EquipmentCollectionRoot) => {
    setCollapsedRoots((current) => {
      const next = new Set(current)
      if (next.has(root)) next.delete(root)
      else next.add(root)
      return next
    })
  }

  const renderFolder = (folder: EquipmentLibraryFolder, depth = 0): ReactNode => {
    const children = itemFolders.filter((candidate) => candidate.collectionRoot === folder.collectionRoot && candidate.parentId === folder.id)
    const count = entries.filter((entry) => entry.folderId === folder.id).length
    const selected = selection.kind === 'root' && selection.folderId === folder.id
    const expandable = children.length > 0
    return <div className="equipment-tree-node" key={folder.id} style={{ '--equipment-tree-depth': depth } as React.CSSProperties}>
      <div className={`equipment-tree-row${selected ? ' selected' : ''}`}>
        {expandable
          ? <button className="equipment-tree-chevron" onClick={() => void onToggle(folder)} title={folder.expanded ? labels.collapse : labels.expand} aria-label={folder.expanded ? labels.collapse : labels.expand}>{folder.expanded ? <ChevronDown /> : <ChevronRight />}</button>
          : <span className="equipment-tree-leaf-marker" aria-hidden="true" />}
        <button className="equipment-tree-name" onClick={() => onSelect({ kind: 'root', root: folder.collectionRoot!, folderId: folder.id })}><Folder /><span>{folder.name}</span><small>{count}</small></button>
      </div>
      {expandable && folder.expanded && children.map((child) => renderFolder(child, depth + 1))}
    </div>
  }

  return <div className="equipment-collection-tree">
    {!readOnly && <div className="equipment-tree-toolbar">
      <button disabled={selection.kind !== 'root' || busy} onClick={beginCreate} title={labels.newFolder} aria-label={labels.newFolder}><FolderPlus /></button>
      <button disabled={!selectedFolder} onClick={() => selectedFolder && setEditor({ mode: 'rename', folderId: selectedFolder.id, name: selectedFolder.name })} title={labels.rename}><Pencil /></button>
      <button className="danger" disabled={!selectedFolder || busy} onClick={() => selectedFolder && void onDelete(selectedFolder)} title={labels.delete}><Trash2 /></button>
    </div>}
    {!readOnly && editor && <div className="equipment-tree-editor">
      <input autoFocus value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') void submit(); if (event.key === 'Escape') setEditor(null) }} />
      <button disabled={busy || !editor.name.trim()} onClick={() => void submit()}><Save /></button>
      <button disabled={busy} onClick={() => setEditor(null)}><X /></button>
    </div>}
    {allLabel && <button className={`equipment-tree-row equipment-tree-all-row${selection.kind === 'all' ? ' selected' : ''}`} onClick={() => onSelect({ kind: 'all' })}><span className="equipment-tree-chevron-placeholder" aria-hidden="true" /><span className="equipment-tree-all-name"><FolderTree /><span>{allLabel}</span><small>{entries.length}</small></span></button>}
    {roots.map((root) => {
      const rootFolders = itemFolders.filter((folder) => folder.collectionRoot === root.id && !folder.parentId)
      const rootEntries = entries.filter((entry) => entry.collectionRoot === root.id)
      const selected = selection.kind === 'root' && selection.root === root.id && !selection.folderId
      const collapsed = collapsedRoots.has(root.id)
      const expandable = rootFolders.length > 0
      return <section className="equipment-tree-root-group" key={root.id}>
        <div className={`equipment-tree-row equipment-tree-root-row${selected ? ' selected' : ''}`}>
          {expandable
            ? <button className="equipment-tree-chevron" onClick={() => toggleRoot(root.id)} title={collapsed ? labels.expand : labels.collapse} aria-label={collapsed ? labels.expand : labels.collapse}>{collapsed ? <ChevronRight /> : <ChevronDown />}</button>
            : <span className="equipment-tree-leaf-marker" aria-hidden="true" />}
          <button className="equipment-tree-name" onClick={() => onSelect({ kind: 'root', root: root.id })}><Folder /><span>{root.label}</span><small>{rootEntries.length}</small></button>
        </div>
        {!collapsed && rootFolders.map((folder) => renderFolder(folder))}
      </section>
    })}
  </div>
}
