import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type ShareDocument = HydratedDocument<Share>

@Schema({ timestamps: true })
export class Share {
    @Prop({ required: true })
    i: number

    @Prop({ required: true })
    s_ij: string

    @Prop({ required: true })
    t_ij: string

    @Prop({ type: Object, required: true })
    paillierPublicKey: PaillierPublicKey
}

export const ShareSchema = SchemaFactory.createForClass(Share)
