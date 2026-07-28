import packageMetadata from '../../package.json'

export const SUPERPOE_NAME = packageMetadata.build.productName || packageMetadata.name
export const SUPERPOE_PACKAGE_VERSION = packageMetadata.version
export const SUPERPOE_GAME_VERSION = packageMetadata.superpoe.gameVersion
export const SUPERPOE_REVISION = packageMetadata.superpoe.revision
export const SUPERPOE_VERSION = `${SUPERPOE_GAME_VERSION}.${SUPERPOE_REVISION}`
export const SUPERPOE_VERSION_LABEL = `v ${SUPERPOE_VERSION}`
