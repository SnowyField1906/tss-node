import * as Crypto from '@toruslabs/eccrypto'

export const generatePrivateKey = (): string => {
    const privateKey: Buffer = Crypto.generatePrivate()
    const serializedPrivateKey: string = privateKey.toString('hex')
    return serializedPrivateKey
}
export const generateKeyPair = (): [string, string] => {
    const privateKey: Buffer = Crypto.generatePrivate()
    const publicKey: Buffer = Crypto.getPublic(privateKey)

    const serializedPrivateKey: string = privateKey.toString('hex')
    const serializedPublicKey: string = publicKey.toString('hex')

    return [serializedPrivateKey, serializedPublicKey]
}

export const decrypt = async (privateKey: string, opts: Ecies): Promise<string> => {
    const deserializedPrivateKey: Buffer = Buffer.from(privateKey, 'hex')
    const deserializeOpts: Crypto.Ecies = {
        iv: Buffer.from(opts.iv, 'hex'),
        ephemPublicKey: Buffer.from(opts.ephemPublicKey, 'hex'),
        ciphertext: Buffer.from(opts.ciphertext, 'hex'),
        mac: Buffer.from(opts.mac, 'hex'),
    }

    const decrypted: Buffer = await Crypto.decrypt(deserializedPrivateKey, deserializeOpts)
    const serializedDecrypted: string = decrypted.toString('hex')

    return serializedDecrypted
}
export const encrypt = async (publicKeyTo: string, message: string): Promise<Ecies> => {
    const deserializedPublicKeyTo: Buffer = Buffer.from(publicKeyTo, 'hex')
    const deserializedMessage: Buffer = Buffer.from(message, 'hex')

    const encrypted: Crypto.Ecies = await Crypto.encrypt(deserializedPublicKeyTo, deserializedMessage)
    const serializedEncrypted: Ecies = {
        iv: encrypted.iv.toString('hex'),
        ephemPublicKey: encrypted.ephemPublicKey.toString('hex'),
        ciphertext: encrypted.ciphertext.toString('hex'),
        mac: encrypted.mac.toString('hex'),
    }

    return serializedEncrypted
}

export const sign = async (privateKey: string, message: string): Promise<string> => {
    const deserializedPrivateKey: Buffer = Buffer.from(privateKey, 'hex')
    const deserializedMessage: Buffer = Buffer.from(message, 'hex')

    const signature: Buffer = await Crypto.sign(deserializedPrivateKey, deserializedMessage)
    const serializedSignature: string = signature.toString('hex')

    return serializedSignature
}
export const verify = async (publicKey: string, message: string, signature: string): Promise<boolean> => {
    const deserializedPublicKey: Buffer = Buffer.from(publicKey, 'hex')
    const deserializedMessage: Buffer = Buffer.from(message, 'hex')
    const deserializedSignature: Buffer = Buffer.from(signature, 'hex')

    return Crypto.verify(deserializedPublicKey, deserializedMessage, deserializedSignature)
}

export const getPublicKey = (privateKey: string): string => {
    const deserializedPrivateKey: Buffer = Buffer.from(privateKey, 'hex')

    const publicKey: Buffer = Crypto.getPublic(deserializedPrivateKey)
    const serializedPublicKey: string = publicKey.toString('hex')

    return serializedPublicKey
}
