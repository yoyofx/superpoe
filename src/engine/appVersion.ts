import packageMetadata from '../../package.json'

export const SUPERPOE_NAME = packageMetadata.build.productName || packageMetadata.name
export const SUPERPOE_PACKAGE_VERSION = packageMetadata.version
export const SUPERPOE_GAME_VERSION = packageMetadata.superpoe.gameVersion
export const SUPERPOE_REVISION = packageMetadata.superpoe.revision
export const SUPERPOE_VERSION = `${SUPERPOE_GAME_VERSION}.${SUPERPOE_REVISION}`
export const SUPERPOE_RELEASE_STAGE = packageMetadata.superpoe.releaseStage
export const SUPERPOE_PREVIEW_TARGET = packageMetadata.superpoe.previewTarget
export const SUPERPOE_VERSION_LABEL = SUPERPOE_RELEASE_STAGE === 'preview' && SUPERPOE_PREVIEW_TARGET
  ? `v ${SUPERPOE_PREVIEW_TARGET} Preview`
  : `v ${SUPERPOE_VERSION}`
