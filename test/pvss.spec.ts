import { BN, C } from '@common'
import { PVSS } from '@libs/pvss'

describe('Pedersen Verifiable Secret Sharing', () => {
    let pvss: PVSS

    beforeAll(() => {
        pvss = new PVSS()
    })

    describe('Polynomial Operations', () => {
        it('should generate polynomial of correct degree', () => {
            const secret = BN.from(C.generatePrivateKey()).umod(C.ORDER)
            const poly = pvss.generatePolynomial(secret, 3)
            expect(poly.length).toBe(4) // degree 3 => 4 coefficients
            expect(poly[0].eq(secret)).toBe(true)
        })

        it('should evaluate polynomial correctly at x=0 (returns secret)', () => {
            const secret = BN.from('abcdef1234567890')
            const poly = pvss.generatePolynomial(secret, 2)
            const y0 = pvss.evaluatePolynomial(poly, BN.ZERO)
            expect(y0.eq(secret)).toBe(true)
        })

        it('should produce different values at different points', () => {
            const secret = BN.from(C.generatePrivateKey()).umod(C.ORDER)
            const poly = pvss.generatePolynomial(secret, 2)
            const y1 = pvss.evaluatePolynomial(poly, BN.from(1))
            const y2 = pvss.evaluatePolynomial(poly, BN.from(2))
            expect(y1.eq(y2)).toBe(false)
        })
    })

    describe('Pedersen Commitments', () => {
        it('should generate commitments matching polynomial length', () => {
            const secret = BN.from(C.generatePrivateKey()).umod(C.ORDER)
            const f = pvss.generatePolynomial(secret, 2)
            const g = pvss.generatePolynomial(BN.from(C.generatePrivateKey()).umod(C.ORDER), 2)
            const commitments = pvss.generatePedersenCommitments(f, g)
            expect(commitments.length).toBe(3)
            commitments.forEach((c) => expect(c.length).toBeGreaterThan(60)) // valid hex point
        })

        it('should verify valid shares against Pedersen commitments', () => {
            const n = 3,
                t = 2
            const secret = BN.from(C.generatePrivateKey()).umod(C.ORDER)
            const noise = BN.from(C.generatePrivateKey()).umod(C.ORDER)
            const f = pvss.generatePolynomial(secret, t - 1)
            const g = pvss.generatePolynomial(noise, t - 1)
            const commitments = pvss.generatePedersenCommitments(f, g)

            for (let j = 1; j <= n; j++) {
                const jBN = BN.from(j)
                const s = pvss.evaluatePolynomial(f, jBN)
                const tVal = pvss.evaluatePolynomial(g, jBN)
                expect(pvss.verifyShare(jBN, s, tVal, commitments)).toBe(true)
            }
        })

        it('should reject tampered shares', () => {
            const secret = BN.from(C.generatePrivateKey()).umod(C.ORDER)
            const noise = BN.from(C.generatePrivateKey()).umod(C.ORDER)
            const f = pvss.generatePolynomial(secret, 1)
            const g = pvss.generatePolynomial(noise, 1)
            const commitments = pvss.generatePedersenCommitments(f, g)

            const j = BN.from(1)
            const s = pvss.evaluatePolynomial(f, j)
            const tVal = pvss.evaluatePolynomial(g, j)
            // Tamper with s
            const tamperedS = s.add(BN.ONE).umod(C.ORDER)
            expect(pvss.verifyShare(j, tamperedS, tVal, commitments)).toBe(false)
        })
    })

    describe('Feldman Commitments', () => {
        it('should generate Feldman commitments from polynomial', () => {
            const secret = BN.from(C.generatePrivateKey()).umod(C.ORDER)
            const f = pvss.generatePolynomial(secret, 2)
            const commitments = pvss.generateFeldmanCommitments(f)
            expect(commitments.length).toBe(3)
            // A_0 = G * secret
            const expected = C.secp256k1.curve.g.mul(secret)
            const actual = C.secp256k1.curve.decodePoint(commitments[0], 'hex')
            expect(actual.eq(expected)).toBe(true)
        })
    })

    describe('Master Share Verification', () => {
        it('should verify aggregated master share against all Feldman commitments', () => {
            const n = 3,
                t = 2
            const secrets: any[] = []
            const polys: any[][] = []
            const allFeldman: string[][] = []

            // Each node generates a polynomial
            for (let i = 0; i < n; i++) {
                const s = BN.from(C.generatePrivateKey()).umod(C.ORDER)
                secrets.push(s)
                const f = pvss.generatePolynomial(s, t - 1)
                polys.push(f)
                allFeldman.push(pvss.generateFeldmanCommitments(f))
            }

            // For each node j, compute master share x_j = sum of f_i(j) for all i
            for (let j = 1; j <= n; j++) {
                let x_j = BN.ZERO
                for (let i = 0; i < n; i++) {
                    x_j = x_j.add(pvss.evaluatePolynomial(polys[i], BN.from(j))).umod(C.ORDER)
                }
                expect(pvss.verifyMasterShare(BN.from(j), x_j, allFeldman)).toBe(true)
            }
        })
    })
})
