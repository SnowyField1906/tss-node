import { BN, C, P } from '@common'

describe('Paillier Homomorphic Encryption', () => {
    let publicKey: PaillierPublicKey
    let privateKey: PaillierPrivateKey
    let paillier: Paillier

    beforeAll(async () => {
        paillier = await P.generateKeyPair(1024)
        publicKey = paillier.publicKey
        privateKey = paillier.privateKey
    })

    describe('Basic encrypt/decrypt', () => {
        it('should decrypt to original plaintext', () => {
            const m = BN.from(42)
            const c = P.encrypt(publicKey, m)
            expect(P.decrypt(paillier, c).eq(m)).toBe(true)
        })

        it('should encrypt zero correctly', () => {
            const m = BN.ZERO
            const c = P.encrypt(publicKey, m)
            expect(P.decrypt(paillier, c).eq(m)).toBe(true)
        })

        it('should handle large values', () => {
            const m = BN.from('0xdeadbeefcafebabe1234567890abcdef')
            const c = P.encrypt(publicKey, m)
            expect(P.decrypt(paillier, c).eq(m)).toBe(true)
        })

        it('should produce different ciphertexts for same plaintext (randomized)', () => {
            const m = BN.from(100)
            const c1 = P.encrypt(publicKey, m)
            const c2 = P.encrypt(publicKey, m)
            expect(c1).not.toBe(c2)
            expect(P.decrypt(paillier, c1).eq(P.decrypt(paillier, c2))).toBe(true)
        })
    })

    describe('Additive homomorphism', () => {
        it('E(a) + E(b) = E(a + b)', () => {
            const a = BN.from(123)
            const b = BN.from(456)
            const c1 = P.encrypt(publicKey, a)
            const c2 = P.encrypt(publicKey, b)
            const cSum = P.add(publicKey, c1, c2)
            expect(P.decrypt(paillier, cSum).eq(a.add(b))).toBe(true)
        })

        it('sum of multiple encryptions', () => {
            const values = [BN.from(10), BN.from(20), BN.from(30), BN.from(40)]
            let cSum = P.encrypt(publicKey, BN.ZERO)
            for (const v of values) {
                cSum = P.add(publicKey, cSum, P.encrypt(publicKey, v))
            }
            expect(P.decrypt(paillier, cSum).eq(BN.from(100))).toBe(true)
        })
    })

    describe('Scalar multiplication', () => {
        it('E(a) × k = E(a × k)', () => {
            const a = BN.from(7)
            const k = BN.from(6)
            const ca = P.encrypt(publicKey, a)
            const cMul = P.multiply(publicKey, ca, k)
            expect(P.decrypt(paillier, cMul).eq(a.mul(k))).toBe(true)
        })

        it('E(a) × 0 = E(0)', () => {
            const a = BN.from(999)
            const ca = P.encrypt(publicKey, a)
            const cMul = P.multiply(publicKey, ca, BN.ZERO)
            expect(P.decrypt(paillier, cMul).eq(BN.ZERO)).toBe(true)
        })

        it('E(a) × 1 = E(a)', () => {
            const a = BN.from(42)
            const ca = P.encrypt(publicKey, a)
            const cMul = P.multiply(publicKey, ca, BN.ONE)
            expect(P.decrypt(paillier, cMul).eq(a)).toBe(true)
        })
    })

    describe('MtA simulation', () => {
        it('should produce correct additive shares of a product', () => {
            // Alice has a, Bob has b. They want shares alpha, beta s.t. alpha + beta = a × b
            const a = BN.from(13)
            const b = BN.from(17)
            const beta = BN.from(42) // random blinding

            const order = BN.from(publicKey.n)

            // Bob encrypts his value
            const E_b = P.encrypt(publicKey, b)

            // Alice computes: E(a×b - beta) using homomorphism
            const term1 = P.multiply(publicKey, E_b, a) // E(a×b)
            const negBeta = order.sub(beta.mod(order))
            const term2 = P.encrypt(publicKey, negBeta) // E(-beta mod n)
            const E_alpha = P.add(publicKey, term1, term2) // E(a×b - beta)

            // Bob decrypts to get alpha
            const alpha = P.decrypt(paillier, E_alpha)

            // Verify: alpha + beta ≡ a × b (mod n)
            expect(alpha.add(beta).mod(order).eq(a.mul(b))).toBe(true)
        })

        it('should work with secp256k1-order-sized values', () => {
            const a = BN.from('0x1234567890abcdef1234567890abcdef12345678')
            const b = BN.from('0xfedcba0987654321fedcba0987654321fedcba09')
            const beta = BN.from('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').mod(C.ORDER)
            const order = BN.from(publicKey.n)

            const E_b = P.encrypt(publicKey, b)
            const term1 = P.multiply(publicKey, E_b, a)
            const negBeta = order.sub(beta.mod(order))
            const E_alpha = P.add(publicKey, term1, P.encrypt(publicKey, negBeta))
            const alpha = P.decrypt(paillier, E_alpha)

            expect(alpha.add(beta).mod(order).eq(a.mul(b).mod(order))).toBe(true)
        })
    })

    describe('Cross-key operations', () => {
        it('cannot decrypt with different key', async () => {
            const paillier2 = await P.generateKeyPair(1024)

            const m = BN.from(42)
            const c = P.encrypt(publicKey, m)
            const decrypted = P.decrypt(paillier2, c)
            expect(decrypted).not.toBe(m)
        })
    })
})
