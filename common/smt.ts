import { H } from '@common'

export class SMT {
    private depth: number
    private defaultHashes: string[]
    private nodes: Map<string, string>

    constructor(depth: number = 256) {
        this.depth = depth
        this.nodes = new Map()
        this.defaultHashes = new Array(depth + 1)

        this.defaultHashes[0] = H.keccak256(Buffer.from('00', 'hex'))

        for (let i = 1; i <= depth; i++) {
            const prev = this.defaultHashes[i - 1]
            const prevBuf = Buffer.from(prev, 'hex')
            this.defaultHashes[i] = H.keccak256(Buffer.concat([prevBuf, prevBuf] as any))
        }
    }

    public getRoot(): string {
        const rootHash = this.nodes.get('')
        return rootHash ? rootHash : this.defaultHashes[this.depth]
    }

    private hexToBinary(hex: string): string {
        const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
        let binary = ''
        for (let i = 0; i < cleanHex.length; i++) {
            binary += parseInt(cleanHex[i], 16).toString(2).padStart(4, '0')
        }
        return binary
    }

    public update(keyHex: string, leafHex: string): void {
        const leafHash = H.keccak256(Buffer.from(leafHex, 'hex'))
        let keyBits = this.hexToBinary(keyHex)

        if (keyBits.length < this.depth) {
            keyBits = keyBits.padStart(this.depth, '0')
        } else if (keyBits.length > this.depth) {
            keyBits = keyBits.slice(keyBits.length - this.depth)
        }

        this.nodes.set(keyBits, leafHash)

        // update from leaf to root
        for (let h = 0; h < this.depth; h++) {
            const currentPath = keyBits.slice(0, this.depth - h)
            const parentPath = currentPath.slice(0, -1)

            const isLeft = currentPath[currentPath.length - 1] === '0'
            const siblingPath = parentPath + (isLeft ? '1' : '0')

            const currentVal = this.nodes.get(currentPath) || this.defaultHashes[h]
            const siblingVal = this.nodes.get(siblingPath) || this.defaultHashes[h]

            const leftBuf = Buffer.from(isLeft ? currentVal : siblingVal, 'hex')
            const rightBuf = Buffer.from(isLeft ? siblingVal : currentVal, 'hex')

            const parentHash = H.keccak256(Buffer.concat([leftBuf, rightBuf] as any))

            this.nodes.set(parentPath, parentHash)
        }
    }

    public prove(keyHex: string): string[] {
        let keyBits = this.hexToBinary(keyHex)
        if (keyBits.length < this.depth) {
            keyBits = keyBits.padStart(this.depth, '0')
        } else if (keyBits.length > this.depth) {
            keyBits = keyBits.slice(keyBits.length - this.depth)
        }

        const proof: string[] = []
        for (let h = 0; h < this.depth; h++) {
            const currentPath = keyBits.slice(0, this.depth - h)
            const parentPath = currentPath.slice(0, -1)
            const isLeft = currentPath[currentPath.length - 1] === '0'
            const siblingPath = parentPath + (isLeft ? '1' : '0')

            const siblingVal = this.nodes.get(siblingPath) || this.defaultHashes[h]
            proof.push(siblingVal)
        }
        return proof // proof[0] is at leaf level (h=0), proof[255] is at root level (h=255)
    }

    public verify(keyHex: string, valueHex: string, proofHex: string[], rootHex: string): boolean {
        let keyBits = this.hexToBinary(keyHex)
        if (keyBits.length < this.depth) {
            keyBits = keyBits.padStart(this.depth, '0')
        } else if (keyBits.length > this.depth) {
            keyBits = keyBits.slice(keyBits.length - this.depth)
        }

        let currentHash = H.keccak256(Buffer.from(valueHex, 'hex'))

        for (let h = 0; h < this.depth; h++) {
            const isLeft = keyBits[this.depth - 1 - h] === '0'
            const currentBuf = Buffer.from(currentHash, 'hex')
            const proofBuf = Buffer.from(proofHex[h], 'hex')

            if (isLeft) {
                currentHash = H.keccak256(Buffer.concat([currentBuf, proofBuf] as any))
            } else {
                currentHash = H.keccak256(Buffer.concat([proofBuf, currentBuf] as any))
            }
        }
        return currentHash === rootHex
    }

    public computeRootFromProof(keyHex: string, newValueHex: string, proofHex: string[]): string {
        let keyBits = this.hexToBinary(keyHex)
        if (keyBits.length < this.depth) {
            keyBits = keyBits.padStart(this.depth, '0')
        } else if (keyBits.length > this.depth) {
            keyBits = keyBits.slice(keyBits.length - this.depth)
        }

        let currentHash = H.keccak256(Buffer.from(newValueHex, 'hex'))

        for (let h = 0; h < this.depth; h++) {
            const isLeft = keyBits[this.depth - 1 - h] === '0'
            const currentBuf = Buffer.from(currentHash, 'hex')
            const proofBuf = Buffer.from(proofHex[h], 'hex')

            if (isLeft) {
                currentHash = H.keccak256(Buffer.concat([currentBuf, proofBuf] as any))
            } else {
                currentHash = H.keccak256(Buffer.concat([proofBuf, currentBuf] as any))
            }
        }
        return currentHash
    }
}
