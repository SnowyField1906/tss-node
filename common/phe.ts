import * as paillierBigint from 'paillier-bigint'

import { BN } from '@common'

export const generateKeyPair = async (bitLength: number = 2048): Promise<Paillier> => {
    const { publicKey, privateKey } = await paillierBigint.generateRandomKeys(bitLength)
    return {
        publicKey: { n: publicKey.n.toString(16), g: publicKey.g.toString(16) },
        privateKey: { lambda: privateKey.lambda.toString(16), mu: privateKey.mu.toString(16) },
    }
}

export const decrypt = (key: Paillier, c: BN | string): BN => {
    const deserializedPublicKey = new paillierBigint.PublicKey(
        _deserialize(key.publicKey.n),
        _deserialize(key.publicKey.g)
    )
    const deserializedPrivateKey = new paillierBigint.PrivateKey(
        _deserialize(key.privateKey.lambda),
        _deserialize(key.privateKey.mu),
        deserializedPublicKey
    )
    const decrypted = deserializedPrivateKey.decrypt(_deserialize(c))
    return _serialize(decrypted)
}
export const encrypt = (publicKey: PaillierPublicKey, m: BN | string): BN => {
    const deserializedPublicKey = new paillierBigint.PublicKey(_deserialize(publicKey.n), _deserialize(publicKey.g))
    const encrypted = deserializedPublicKey.encrypt(_deserialize(m))
    return _serialize(encrypted)
}

export const add = (publicKey: PaillierPublicKey, c1: BN | string, c2: BN | string): BN => {
    const deserializedPublicKey = new paillierBigint.PublicKey(_deserialize(publicKey.n), _deserialize(publicKey.g))
    const addition = deserializedPublicKey.addition(_deserialize(c1), _deserialize(c2))
    return _serialize(addition)
}
export const multiply = (publicKey: PaillierPublicKey, c: BN | string, k: BN | string): BN => {
    const deserializedPublicKey = new paillierBigint.PublicKey(_deserialize(publicKey.n), _deserialize(publicKey.g))
    const multiplication = deserializedPublicKey.multiply(_deserialize(c), _deserialize(k))
    return _serialize(multiplication)
}

const _deserialize = (v: BN | string): bigint => {
    switch (typeof v) {
        case 'string':
            return v.startsWith('0x') ? BigInt(v) : BigInt(`0x${v}`)
        case 'object':
            return BigInt(`0x${v.toString(16)}`)
    }
}
const _serialize = (v: bigint): BN => {
    return BN.from(v.toString(16))
}
