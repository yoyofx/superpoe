import { PobBuildObject, type PobBuildChange, type PobBuildCommand } from '@/engine/pobBuildObject'

export interface ActiveBuildSession {
  readonly buildId: string | null
  readonly object: PobBuildObject
  readonly dirty: boolean
  readonly revision: number
  apply(command: PobBuildCommand): PobBuildChange
  dispose(): void
}

class ActiveBuildSessionImpl implements ActiveBuildSession {
  private isDisposed = false
  private isDirty = false

  constructor(
    public readonly buildId: string | null,
    public readonly object: PobBuildObject,
  ) {}

  get dirty(): boolean {
    this.assertActive()
    return this.isDirty || this.object.dirty
  }

  get revision(): number {
    this.assertActive()
    return this.object.revision
  }

  apply(command: PobBuildCommand): PobBuildChange {
    this.assertActive()
    const change = this.object.apply(command)
    if (change.changed) this.isDirty = true
    return change
  }

  dispose(): void {
    if (this.isDisposed) return
    this.isDisposed = true
    this.object.dispose()
  }

  private assertActive(): void {
    if (this.isDisposed) throw new Error('ActiveBuildSession has been disposed')
  }
}

export function createActiveBuildSession(buildId: string | null, code: string): ActiveBuildSession {
  return new ActiveBuildSessionImpl(buildId, PobBuildObject.fromCode(code))
}

export function createActiveBuildSessionFromXml(buildId: string | null, xml: string): ActiveBuildSession {
  return new ActiveBuildSessionImpl(buildId, PobBuildObject.fromXml(xml))
}
