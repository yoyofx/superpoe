import { decodeCodeToXml, encodeXmlToCode } from '@/engine/buildCode'
import {
  clonePobXmlDocument,
  getPobXmlElementAtPath,
  parsePobXml,
  serializePobXml,
  type PobXmlDocument,
  type PobXmlElement,
} from '@/engine/pobXmlAst'

export type PobBuildCommand =
  | { type: 'set-attribute'; path: number[]; name: string; value: string; section?: string }

export interface PobBuildChange {
  changed: boolean
  revision: number
  sections: string[]
}

export interface PobBuildSnapshot {
  revision: number
  xml: string
  contentHash: string
}

function hashText(value: string): string {
  // Runtime identity only; persistent file integrity continues to use SHA-256.
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export class PobBuildObject {
  private readonly document: PobXmlDocument
  private readonly originalXml: string
  private changed = false
  private disposed = false
  private currentRevision = 0

  private constructor(document: PobXmlDocument, originalXml: string) {
    this.document = document
    this.originalXml = originalXml
  }

  static fromXml(xml: string): PobBuildObject {
    return new PobBuildObject(parsePobXml(xml), xml)
  }

  static fromCode(code: string): PobBuildObject {
    return PobBuildObject.fromXml(decodeCodeToXml(code))
  }

  get root(): PobXmlElement {
    this.assertActive()
    return this.document.root
  }

  get revision(): number {
    this.assertActive()
    return this.currentRevision
  }

  get dirty(): boolean {
    this.assertActive()
    return this.changed
  }

  apply(command: PobBuildCommand): PobBuildChange {
    this.assertActive()
    if (command.type !== 'set-attribute') throw new Error(`Unsupported PoB build command: ${command.type}`)
    const target = getPobXmlElementAtPath(this.document.root, command.path)
    if (!target) throw new Error('Cannot apply PoB command: XML path does not resolve to an element')
    if (target.attrib[command.name] === command.value) {
      return { changed: false, revision: this.currentRevision, sections: [] }
    }
    target.attrib[command.name] = command.value
    this.changed = true
    this.currentRevision += 1
    return { changed: true, revision: this.currentRevision, sections: command.section ? [command.section] : [] }
  }

  snapshot(): PobBuildSnapshot {
    this.assertActive()
    const xml = this.toXml()
    return { revision: this.currentRevision, xml, contentHash: hashText(xml) }
  }

  toXml(): string {
    this.assertActive()
    return this.changed ? serializePobXml(this.document) : this.originalXml
  }

  toCode(): string {
    this.assertActive()
    return encodeXmlToCode(this.toXml())
  }

  fork(): PobBuildObject {
    this.assertActive()
    return new PobBuildObject(clonePobXmlDocument(this.document), this.toXml())
  }

  dispose(): void {
    this.disposed = true
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('PobBuildObject has been disposed')
  }
}
