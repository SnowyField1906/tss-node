import elliptic from 'elliptic'
import { toChecksumAddress } from 'web3-utils'

import { H } from '@common'

export const secp256k1 = new elliptic.ec('secp256k1')
export const ORDER = secp256k1.curve.n

export const generatePrivateKey = (): string => {
    return generateKeyPair().getPrivate('hex')
}
export const generateKeyPair = (): elliptic.ec.KeyPair => {
    return secp256k1.genKeyPair()
}

export const decodePublicKey = (publicKey: string): Point => {
    const x: string = publicKey.slice(2, 66)
    const y: string = publicKey.slice(66)

    return { x, y }
}
export const encodePublicKey = (point: Point): string => {
    return `04${point.x}${point.y}`
}

export const getPublicKeyFromPrivateKey = (privateKey: string): string => {
    const keypair = secp256k1.keyFromPrivate(privateKey, 'hex')
    return keypair.getPublic().encode('hex', false)
}
export const getAddressFromPrivateKey = (privateKey: string): string => {
    const keypair = secp256k1.keyFromPrivate(privateKey, 'hex')
    const publicKey: string = keypair.getPublic().encode('hex', false).slice(2)
    const lowercaseAddress = `0x${H.keccak256(Buffer.from(publicKey, 'hex')).slice(64 - 38)}`

    return toChecksumAddress(lowercaseAddress)
}
export const getAddressFromPublicKey = (publicKey: string): string => {
    const formattedPublicKey = publicKey.slice(2)
    const publicKeyBytes = Buffer.from(formattedPublicKey, 'hex')

    const hash = H.keccak256(publicKeyBytes)
    const address = hash.slice(-40)

    const hashAddress = H.keccak256(address).slice(2)

    let checksumAddress = '0x'

    for (let i = 0; i < address.length; i++) {
        if (parseInt(hashAddress[i], 16) >= 8) {
            checksumAddress += address[i].toUpperCase()
        } else {
            checksumAddress += address[i]
        }
    }

    return checksumAddress
}

export const ellipticAddition = (p1: Point, p2: Point): Point => {
    const p1CurvePoint = secp256k1.curve.point(p1.x, p1.y)
    const p2CurvePoint = secp256k1.curve.point(p2.x, p2.y)
    const p3CurvePoint = p1CurvePoint.add(p2CurvePoint)

    return {
        x: p3CurvePoint.getX().toString(16),
        y: p3CurvePoint.getY().toString(16),
    }
}
