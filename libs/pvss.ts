import { BN, C, H } from '@common'

export class PVSS {
    private G: any
    private H: any

    constructor() {
        this.G = C.secp256k1.curve.g
        // Generate a deterministic point H where nobody knows the discrete log
        let x = H.sha256('H_Generator_For_PVSS')
        while (true) {
            try {
                this.H = C.secp256k1.curve.pointFromX(BN.from(x).toString(10), true)
                break
            } catch (e) {
                x = H.sha256(x)
            }
        }
    }

    public generatePolynomial(secret: BN, t: number): BN[] {
        const f_poly = [secret]
        for (let i = 1; i <= t; i++) {
            const coeff = BN.from(C.generatePrivateKey()).umod(C.ORDER)
            f_poly.push(coeff)
        }
        return f_poly
    }

    public evaluatePolynomial(poly: BN[], x: BN): BN {
        let y = BN.ZERO
        let xPow = BN.ONE
        for (let i = 0; i < poly.length; i++) {
            y = y.add(poly[i].mul(xPow)).umod(C.ORDER)
            xPow = xPow.mul(x).umod(C.ORDER)
        }
        return y
    }

    public generatePedersenCommitments(f_poly: BN[], g_poly: BN[]): string[] {
        const commitments: string[] = []
        for (let k = 0; k < f_poly.length; k++) {
            const part1 = this.G.mul(f_poly[k])
            const part2 = this.H.mul(g_poly[k])
            const C_k = part1.add(part2)
            commitments.push(C_k.encode('hex', false))
        }
        return commitments
    }

    public verifyShare(j: BN, s: BN, t: BN, commitmentsHex: string[]): boolean {
        const lhs = this.G.mul(s).add(this.H.mul(t))

        let rhs = C.secp256k1.curve.point(null, null)
        for (let k = 0; k < commitmentsHex.length; k++) {
            const A_k = C.secp256k1.curve.decodePoint(commitmentsHex[k], 'hex')
            const jPowK = j.pow(BN.from(k)).umod(C.ORDER)
            rhs = rhs.add(A_k.mul(jPowK))
        }

        return lhs.eq(rhs)
    }

    public generateFeldmanCommitments(f_poly: BN[]): string[] {
        const commitments: string[] = []
        for (let k = 0; k < f_poly.length; k++) {
            const A_k = this.G.mul(f_poly[k])
            commitments.push(A_k.encode('hex', false))
        }
        return commitments
    }

    public verifyMasterShare(i: BN, x_i: BN, A_commitmentsHex: string[][]): boolean {
        const lhs = this.G.mul(x_i)

        let rhs = C.secp256k1.curve.point(null, null) // point at infinity
        for (let j = 0; j < A_commitmentsHex.length; j++) {
            const A_j = A_commitmentsHex[j]
            let jSum = C.secp256k1.curve.decodePoint(A_j[0], 'hex')
            let iPow = BN.ONE
            for (let k = 1; k < A_j.length; k++) {
                iPow = iPow.mul(i).umod(C.ORDER)
                const A_jk = C.secp256k1.curve.decodePoint(A_j[k], 'hex')
                jSum = jSum.add(A_jk.mul(iPow))
            }
            rhs = rhs.add(jSum)
        }

        return lhs.eq(rhs)
    }
}
