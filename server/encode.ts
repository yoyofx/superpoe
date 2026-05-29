import { FastifyInstance } from 'fastify'
import { deflateSync } from 'zlib'

type NodeWeaponSets = Record<string, 1 | 2>

function weaponSetNodes(nodes: string[], nodeWeaponSets: NodeWeaponSets | undefined, mode: 1 | 2): string {
  if (!nodeWeaponSets) return ''
  const nodeSet = new Set(nodes)
  return Object.entries(nodeWeaponSets)
    .filter(([id, m]) => m === mode && nodeSet.has(id))
    .map(([id]) => id)
    .join(',')
}

/** POST /api/code/encode */
export async function encodeRoute(fastify: FastifyInstance) {
  fastify.post<{
    Body: { nodes?: string[]; treeVersion?: string; classId?: string; nodeWeaponSets?: NodeWeaponSets }
  }>(
    '/api/code/encode',
    async (request, reply) => {
      const { nodes, treeVersion, classId, nodeWeaponSets } = request.body || {}

      if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
        return reply.status(400).send({ error: 'Missing or empty "nodes" array' })
      }

      try {
        const tv = treeVersion || '0_4'
        const cid = classId || ''
        const nodeStr = nodes.join(',')
        const ws1 = weaponSetNodes(nodes, nodeWeaponSets, 1)
        const ws2 = weaponSetNodes(nodes, nodeWeaponSets, 2)
        const specChildren = [
          ws1 ? `        <WeaponSet1 nodes="${ws1}"/>` : '',
          ws2 ? `        <WeaponSet2 nodes="${ws2}"/>` : '',
        ].filter(Boolean)

        const xml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<PathOfBuilding2>',
          '  <Build>',
          '    <Tree activeSpec="1">',
          `      <Spec treeVersion="${tv}" classId="${cid}" ascendClassId="" nodes="${nodeStr}" masteryEffects="">`,
          ...specChildren,
          '      </Spec>',
          '    </Tree>',
          '  </Build>',
          '</PathOfBuilding2>',
        ].join('\n')

        const deflated = deflateSync(Buffer.from(xml, 'utf-8'))
        const code = deflated.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')

        return reply.send({
          code,
          nodeCount: nodes.length,
          treeVersion: tv,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(500).send({ error: `Encode failed: ${msg}` })
      }
    },
  )
}
