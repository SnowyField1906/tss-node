import { ConfigService } from '@nestjs/config'

import { BN, C } from '@common'
import { DkgService } from '@services/dkg.service'

const mockData = {
    1: C.generateKeyPair(),
    2: C.generateKeyPair(),
    3: C.generateKeyPair(),
}
class MockModel {
    private data: any[] = []
    async deleteMany(query: any = {}) {
        this.data = []
        return { acknowledged: true, deletedCount: this.data.length }
    }
    async findOne(query: any = {}) {
        return this.data.find((item) => Object.keys(query).every((k) => item[k] === query[k])) || null
    }
    async find(query: any = {}) {
        return this.data.filter((item) => Object.keys(query).every((k) => item[k] === query[k]))
    }
    async updateOne(query: any = {}, updateData: any = {}, options: any = {}) {
        const update = updateData.$set || updateData
        const index = this.data.findIndex((item) => Object.keys(query).every((k) => item[k] === query[k]))
        if (index > -1) this.data[index] = { ...this.data[index], ...update }
        else if (options.upsert) this.data.push({ ...query, ...update })
    }
}
const createMock = (id: number) => {
    const privateKey = mockData[id].getPrivate('hex')
    const config = {
        get: (key: string) => {
            if (key === 'id') return id
            if (key === 'privateKey') return privateKey
            if (key === 'networkPublicKeys')
                return Object.fromEntries(Object.entries(mockData).map(([k, v]) => [k, v.getPublic('hex')]))
            return null
        },
    } as ConfigService
    const keyModel = new MockModel() as any
    const shareModel = new MockModel() as any
    const dkgService = new DkgService(keyModel, shareModel, config)
    return { id, dkgService, keyModel, shareModel }
}

describe('Distributed Key Generation (n=3, t=2)', () => {
    const n = 3,
        t = 2

    let nodes: ReturnType<typeof createMock>[] = []
    const broadcastData: any[] = []
    const feldmanCommitmentsAll: string[][] = []

    beforeAll(() => {
        nodes = [createMock(1), createMock(2), createMock(3)]
    })

    it('Phase 1: Each node generates polynomial, commitments, and Paillier keys', async () => {
        for (const node of nodes) {
            const data = await node.dkgService.broadcastDkgShares(t, n)
            broadcastData.push({ nodeId: node.id, ...data })

            expect(data.commitments.length).toBe(t)
            expect(data.data).toBeDefined()
        }
    })

    it('Phase 2: Each node receives batched shares, verifies, and returns Feldman Commitments', async () => {
        for (const node of nodes) {
            const batchedShares: any[] = []
            for (const senderData of broadcastData) {
                const shareForMe = senderData.data.find((s: any) => s.j === node.id)
                batchedShares.push({
                    i: senderData.nodeId,
                    encryptedPayload: shareForMe.encryptedPayload,
                    commitments: senderData.commitments,
                })
            }

            const data = await node.dkgService.receiveDkgShares(batchedShares)
            feldmanCommitmentsAll.push(data.feldmanCommitments)

            const savedShares = await node.shareModel.find()
            expect(savedShares.length).toBe(n)

            const keyDoc = await node.keyModel.findOne()
            expect(keyDoc.x_i).toBeDefined()
            expect(keyDoc.x_i).not.toBe('0')
        }
    })

    it('Phase 3: Nodes self-verify master shares and reconstruct public key Y', async () => {
        for (const node of nodes) {
            await node.dkgService.computePublicKey(feldmanCommitmentsAll)
        }

        const keyDoc1 = await nodes[0].keyModel.findOne()
        const Y = keyDoc1.Y
        expect(Y).toBeDefined()

        for (const node of nodes) {
            const doc = await node.keyModel.findOne()
            expect(doc.Y).toBe(Y)
        }

        const subset = [1, 2]
        let reconstructedSecret = BN.ZERO

        for (const i of subset) {
            const keyDoc = await nodes[i - 1].keyModel.findOne()
            const x_i = BN.from(keyDoc.x_i)
            let lambda = BN.ONE
            for (const j of subset) {
                if (i === j) continue
                const top = BN.from(j).neg().umod(C.ORDER)
                const bottom = BN.from(i).sub(BN.from(j)).umod(C.ORDER)
                lambda = lambda.mul(top.mul(bottom.invm(C.ORDER))).umod(C.ORDER)
            }
            reconstructedSecret = reconstructedSecret.add(x_i.mul(lambda)).umod(C.ORDER)
        }

        const Y_reconstructed = C.secp256k1.curve.g.mul(reconstructedSecret)
        expect(Y_reconstructed.encode('hex', false)).toBe(Y)
    })
})
