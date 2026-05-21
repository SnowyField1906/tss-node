import * as crypto from 'crypto'

import keccak from 'keccak'

export function keccak256(data: string | Buffer): string {
    const bufferData = typeof data === 'string' ? Buffer.from(data, 'hex') : data
    return keccak('keccak256').update(bufferData).digest('hex')
}

export function sha256(data: string | Buffer): string {
    const bufferData: any = typeof data === 'string' ? Buffer.from(data, 'hex') : data
    return crypto.createHash('sha256').update(bufferData).digest('hex')
}
