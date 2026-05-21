import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type KeyDocument = HydratedDocument<Key>

@Schema({ timestamps: true })
export class Key {
    @Prop({ required: false })
    x_i: string

    @Prop({ required: false })
    Y: string

    @Prop({ type: [String], required: true })
    f_poly: string[]

    @Prop({ type: Object, required: true })
    paillier: Paillier

    @Prop({ type: Object, default: {} })
    chains: {
        [chainId: string]: { nonce: number; root: string }
    }
}

export const KeySchema = SchemaFactory.createForClass(Key)
