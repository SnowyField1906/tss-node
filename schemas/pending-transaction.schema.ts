import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type PendingTransactionDocument = HydratedDocument<PendingTransaction>

@Schema({ timestamps: true })
export class PendingTransaction {
    @Prop({ required: true, unique: true })
    chainId: string

    @Prop({ required: true })
    newRoot: string

    @Prop({ required: true })
    newNonce: number

    @Prop({ required: true })
    messageHash: string
}

export const PendingTransactionSchema = SchemaFactory.createForClass(PendingTransaction)
