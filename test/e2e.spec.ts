import axios from 'axios'
import * as mongoose from 'mongoose'

import { C } from '@common'

const ORCH_URL = 'http://127.0.0.1:4000'
const NODE_1_URL = 'http://127.0.0.1:3001'
const NODE_2_URL = 'http://127.0.0.1:3002'
const NODE_3_URL = 'http://127.0.0.1:3003'

const DB_URIS = {
    ORCH: 'mongodb://127.0.0.1:27017/orchestrator',
    NODE1: 'mongodb://127.0.0.1:27017/node1',
    NODE2: 'mongodb://127.0.0.1:27017/node2',
    NODE3: 'mongodb://127.0.0.1:27017/node3',
}

describe('Comprehensive End-to-End (n=3, t=2)', () => {
    let Y_Public: string

    const chainId = 'mainnet_1'

    const userId_1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const tx1_amount = '100'
    const tx2_amount = '050'

    const userId_2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const tx3_amount = '200'

    const _waitForTssSettlement = async (targetChain: string, currentNonce: number, retries = 30) => {
        for (let i = 0; i < retries; i++) {
            try {
                await new Promise((resolve) => setTimeout(resolve, 250))
                const res = await axios.get(`${ORCH_URL}/fund/settlement-data`, {
                    params: { chainId: targetChain },
                })
                if (res.data && res.data.nonce === currentNonce && res.data.signature) {
                    return res.data
                }
            } catch (e) {}
        }
        throw new Error(`Timeout waiting for TSS signature to populate on chain ${targetChain}`)
    }
    const _formatSignature = (signature: { r: string; s: string }) => {
        return { r: signature.r.replace('0x', ''), s: signature.s.replace('0x', '') }
    }

    beforeAll(async () => {
        const uris = Object.values(DB_URIS)
        for (const uri of uris) {
            const conn = await mongoose.createConnection(uri).asPromise()
            await conn.db.dropDatabase()
            await conn.close()
        }
    })

    it('Phase 1: Orchestrator initializes DKG and distributes keys', async () => {
        const response = await axios.post(`${ORCH_URL}/dkg/initialize`)

        expect(response.status).toBe(201)
        expect(response.data.success).toBe(true)

        const conn1 = await mongoose.createConnection(DB_URIS.NODE1).asPromise()
        const node1KeyDoc = await conn1.collection('keys').findOne({})

        expect(node1KeyDoc).toBeDefined()
        expect(node1KeyDoc.Y).toBeDefined()

        Y_Public = node1KeyDoc.Y

        await conn1.close()
    })

    let tx1_messageHash: string
    let tx1_root: string

    it('Phase 2.1: Subset (1, 2) proposes initial transaction', async () => {
        const res1 = await axios.post(`${NODE_1_URL}/tss/propose`, {
            chainId,
            userId: userId_1,
            amount: tx1_amount,
        })
        tx1_messageHash = res1.data.messageHash

        const res2 = await axios.post(`${NODE_2_URL}/tss/propose`, {
            chainId,
            userId: userId_1,
            amount: tx1_amount,
        })
        expect(res2.data.messageHash).toBe(tx1_messageHash)
    })

    it('Phase 2.2: Orchestrator verifies signature and commits state for Tx1', async () => {
        const settlementData = await _waitForTssSettlement(chainId, 1)
        expect(settlementData.nonce).toBe(1)

        const proofRes = await axios.get(`${ORCH_URL}/fund/proof`, { params: { chainId, userId: userId_1 } })
        expect(proofRes.data.balance).toBe(`0x${tx1_amount}`)

        const key = C.secp256k1.keyFromPublic(Y_Public, 'hex')
        expect(key.verify(tx1_messageHash, _formatSignature(settlementData.signature))).toBe(true)

        tx1_root = settlementData.root
    })

    it('Phase 3: Nodes reject mismatched payloads', async () => {
        const res1 = await axios.post(`${NODE_1_URL}/tss/propose`, { chainId, userId: userId_1, amount: '500' })
        const res3 = await axios.post(`${NODE_3_URL}/tss/propose`, { chainId, userId: userId_1, amount: '999' })

        expect(res1.data.messageHash).not.toBe(res3.data.messageHash)

        const resOrch = await axios.get(`${ORCH_URL}/fund/settlement-data`, { params: { chainId } })
        expect(resOrch.data.nonce).toBe(1)
    })

    let tx2_messageHash: string
    let tx2_root: string

    it('Phase 4.1: Subset (2, 3) proposes sequential transaction', async () => {
        const res2 = await axios.post(`${NODE_2_URL}/tss/propose`, { chainId, userId: userId_1, amount: tx2_amount })
        const res3 = await axios.post(`${NODE_3_URL}/tss/propose`, { chainId, userId: userId_1, amount: tx2_amount })

        expect(res2.data.messageHash).toBe(res3.data.messageHash)
        tx2_messageHash = res2.data.messageHash
    })

    it('Phase 4.2: Orchestrator verifies signature and accumulates balance for Tx2', async () => {
        const settlementData = await _waitForTssSettlement(chainId, 2)
        expect(settlementData.nonce).toBe(2)

        const proofRes = await axios.get(`${ORCH_URL}/fund/proof`, { params: { chainId, userId: userId_1 } })
        expect(proofRes.data.balance).toBe('0x150')

        const key = C.secp256k1.keyFromPublic(Y_Public, 'hex')
        expect(key.verify(tx2_messageHash, _formatSignature(settlementData.signature))).toBe(true)

        tx2_root = settlementData.root
    })

    let tx3_messageHash: string
    let tx3_root: string

    it('Phase 5.1: Subset (1, 3) proposes transaction for new user', async () => {
        const res1 = await axios.post(`${NODE_1_URL}/tss/propose`, { chainId, userId: userId_2, amount: tx3_amount })
        const res3 = await axios.post(`${NODE_3_URL}/tss/propose`, { chainId, userId: userId_2, amount: tx3_amount })
        tx3_messageHash = res1.data.messageHash
    })

    it('Phase 5.2: Orchestrator verifies signature and updates Merkle tree', async () => {
        const settlementData = await _waitForTssSettlement(chainId, 3)
        expect(settlementData.nonce).toBe(3)

        const proofRes = await axios.get(`${ORCH_URL}/fund/proof`, { params: { chainId, userId: userId_2 } })
        expect(proofRes.data.balance).toBe(`0x${tx3_amount}`)

        const key = C.secp256k1.keyFromPublic(Y_Public, 'hex')
        expect(key.verify(tx3_messageHash, _formatSignature(settlementData.signature))).toBe(true)

        tx3_root = settlementData.root
    })

    it('Phase 6: Nodes process multi-chain proposals concurrently', async () => {
        const chain_A = 'bsc_1'
        const chain_B = 'polygon_1'

        await Promise.all([
            axios.post(`${NODE_1_URL}/tss/propose`, { chainId: chain_A, userId: userId_1, amount: '10' }),
            axios.post(`${NODE_2_URL}/tss/propose`, { chainId: chain_A, userId: userId_1, amount: '10' }),
            axios.post(`${NODE_2_URL}/tss/propose`, { chainId: chain_B, userId: userId_2, amount: '20' }),
            axios.post(`${NODE_3_URL}/tss/propose`, { chainId: chain_B, userId: userId_2, amount: '20' }),
        ])

        const [settle_A, settle_B] = await Promise.all([
            _waitForTssSettlement(chain_A, 1),
            _waitForTssSettlement(chain_B, 1),
        ])

        expect(settle_A.nonce).toBe(1)
        expect(settle_B.nonce).toBe(1)

        const proof_A = await axios.get(`${ORCH_URL}/fund/proof`, { params: { chainId: chain_A, userId: userId_1 } })
        expect(proof_A.data.balance).toBe('0x10')

        const proof_B = await axios.get(`${ORCH_URL}/fund/proof`, { params: { chainId: chain_B, userId: userId_2 } })
        expect(proof_B.data.balance).toBe('0x20')

        const conn2 = await mongoose.createConnection(DB_URIS.NODE2).asPromise()
        const node2Key = await conn2.collection('keys').findOne({})

        expect(node2Key.chains[chain_A].nonce).toBe(1)
        expect(node2Key.chains[chain_B].nonce).toBe(1)
        await conn2.close()
    })

    let tx4_root: string

    it('Phase 7: Orchestrator resolves override', async () => {
        const res_A = await axios.post(`${NODE_1_URL}/tss/propose`, { chainId, userId: userId_1, amount: '010' })

        const res_B1 = await axios.post(`${NODE_1_URL}/tss/propose`, { chainId, userId: userId_1, amount: '070' })
        const res_B2 = await axios.post(`${NODE_2_URL}/tss/propose`, { chainId, userId: userId_1, amount: '070' })

        expect(res_A.data.messageHash).not.toBe(res_B1.data.messageHash)
        expect(res_B1.data.messageHash).toBe(res_B2.data.messageHash)

        const settlementData = await _waitForTssSettlement(chainId, 4)
        expect(settlementData.nonce).toBe(4)

        const proofRes = await axios.get(`${ORCH_URL}/fund/proof`, { params: { chainId, userId: userId_1 } })
        expect(proofRes.data.balance).toBe('0x1c0')

        tx4_root = settlementData.root
    })

    it('Phase 8: Orchestrator generates exact Merkle proofs for users', async () => {
        const proof1 = await axios
            .get(`${ORCH_URL}/fund/proof`, { params: { chainId, userId: userId_1 } })
            .then((r) => r.data)

        expect(proof1.balance).toBe('0x1c0')
        expect(proof1.proof.length).toBe(256)

        const proof2 = await axios
            .get(`${ORCH_URL}/fund/proof`, { params: { chainId, userId: userId_2 } })
            .then((r) => r.data)

        expect(proof2.balance).toBe('0x200')
        expect(proof2.proof.length).toBe(256)
    })

    it('Phase 9: Node catch-up new state', async () => {
        const res3 = await axios.post(`${NODE_3_URL}/tss/propose`, { chainId, userId: userId_2, amount: '010' })
        const res1 = await axios.post(`${NODE_1_URL}/tss/propose`, { chainId, userId: userId_2, amount: '010' })

        expect(res3.data.messageHash).toBe(res1.data.messageHash)

        const settlementData = await _waitForTssSettlement(chainId, 5)
        expect(settlementData.nonce).toBe(5)

        const proofRes = await axios.get(`${ORCH_URL}/fund/proof`, { params: { chainId, userId: userId_2 } })
        expect(proofRes.data.balance).toBe('0x210')
    })
})
