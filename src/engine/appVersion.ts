import packageMetadata from '../../package.json'

export const SUPERPOE_NAME = packageMetadata.build.productName || packageMetadata.name
export const SUPERPOE_VERSION = packageMetadata.version
export const SUPERPOE_VERSION_LABEL = `v ${SUPERPOE_VERSION}`
