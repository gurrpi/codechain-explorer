import { Client, SearchResponse } from "elasticsearch";
import { Block, SignedParcel, H256, H160, Transaction, ChangeShardState, Asset, AssetScheme, AssetTransferTransaction, AssetMintTransaction } from "codechain-sdk/lib/core/classes";
import { getTransactionFromJSON } from "codechain-sdk/lib/core/transaction/Transaction";
import * as _ from "lodash";
import { BlockDoc, ParcelDoc, Type, ChangeShardStateDoc, AssetTransferTransactionDoc, AssetMintTransactionDoc, PaymentDoc, Converter } from "../db/DocType";

export class ElasticSearchAgent {
    private client: Client;
    constructor(host: string) {
        this.client = new Client({
            host
        });
    }

    public ping = async (): Promise<string> => {
        return this.client.ping({ requestTimeout: 30000 }).then((data) => {
            return 'pong';
        });
    }

    public getLastBlockNumber = async (): Promise<number> => {
        return this.searchBlock({
            sort: [
                {
                    "number": { order: "desc" }
                }
            ],
            size: 1,
            query: {
                "bool": {
                    "filter": {
                        "term": {
                            "isRetracted": false
                        }
                    }
                }
            }
        }).then((response: SearchResponse<BlockDoc>) => {
            if (response.hits.total === 0) {
                return -1;
            }
            return response.hits.hits[0]._source.number;
        });
    }

    public getBlockByHash = async (hash: H256): Promise<Block> => {
        return this.searchBlock({
            sort: [
                {
                    "number": { order: "desc" }
                }
            ],
            query: {
                "bool": {
                    "must": [
                        { "term": { "hash": hash.value } }
                    ],
                    "filter": {
                        "term": {
                            "isRetracted": false
                        }
                    }
                }
            }
        }).then((response: SearchResponse<BlockDoc>) => {
            return Block.fromJSON(response.hits.hits[0]._source);
        });
    }

    public getParcel = async (hash: H256): Promise<SignedParcel> => {
        return this.searchBlock({
            sort: [
                {
                    "number": { order: "desc" }
                }
            ],
            query: {
                "bool": {
                    "must": [
                        { "term": { "parcels.hash": hash.value } }
                    ],
                    "filter": {
                        "term": {
                            "isRetracted": false
                        }
                    }
                }
            }
        }).then((response: SearchResponse<BlockDoc>) => {
            if (response.hits.total === 0) {
                return null;
            }
            const findBlock = Block.fromJSON(response.hits.hits[0]._source);
            const parcelData = _.filter(findBlock.parcels, (parcel) => {
                return parcel.hash().value === hash.value;
            });
            return parcelData[0];
        });
    }

    public getTransaction = async (hash: H256): Promise<Transaction> => {
        return this.searchBlock({
            sort: [
                {
                    "number": { order: "desc" }
                }
            ],
            query: {
                "bool": {
                    "must": [
                        { "term": { "parcels.action.transactions.data.hash": hash.value } }
                    ],
                    "filter": {
                        "term": {
                            "isRetracted": false
                        }
                    }
                }
            }
        }).then((response: SearchResponse<BlockDoc>) => {
            if (response.hits.total === 0) {
                return null;
            }
            const findBlock = Block.fromJSON(response.hits.hits[0]._source);
            let transactionData: Transaction;
            _.each(findBlock.parcels, (parcel) => {
                if (parcel.unsigned.action instanceof ChangeShardState) {
                    _.each(parcel.unsigned.action.transactions, (transaction: Transaction) => {
                        if (transaction.hash().value === hash.value) {
                            transactionData = transaction;
                        }
                    });
                }
            })
            return transactionData;
        });
    }

    public getBlock = async (blockNumber: number): Promise<Block> => {
        return this.searchBlock({
            sort: [
                {
                    "number": { order: "desc" }
                }
            ],
            query: {
                "bool": {
                    "must": [
                        { "term": { "number": blockNumber } }
                    ],
                    "filter": {
                        "term": {
                            "isRetracted": false
                        }
                    }
                }
            }
        }).then((response: SearchResponse<BlockDoc>) => {
            return Block.fromJSON(response.hits.hits[0]._source);
        });
    }

    public getAssetTransferTransactions = async (assetType: H256): Promise<Transaction[]> => {
        return this.searchBlock({
            sort: [
                {
                    "number": { order: "desc" }
                }
            ],
            query: {
                "bool": {
                    "must": [
                        { "term": { "parcels.action.transactions.data.outputs.assetType": assetType.value } }
                    ],
                    "filter": {
                        "term": {
                            "isRetracted": false
                        }
                    }
                }
            }
        }).then((response: SearchResponse<BlockDoc>) => {
            if (response.hits.total === 0) {
                return [];
            }

            const resultTransactions = [];
            _.each(response.hits.hits, hit => {
                const findBlock = Block.fromJSON(hit._source);
                _.each(findBlock.parcels, (parcel) => {
                    if (parcel.unsigned.action instanceof ChangeShardState) {
                        _.each(parcel.unsigned.action.transactions, (transaction: Transaction) => {
                            if (transaction instanceof AssetTransferTransaction) {
                                if (_.findIndex(transaction.toJSON().data.outputs, output => {
                                    return output.assetType === assetType.value;
                                }) !== -1) {
                                    resultTransactions.push(transaction);
                                }
                            }
                        });
                    }
                })
            })
            return resultTransactions;
        });
    }

    public getAssetMintTransaction = async (assetType: H256): Promise<AssetMintTransaction> => {
        return this.searchBlock({
            sort: [
                {
                    "number": { order: "desc" }
                }
            ],
            query: {
                "bool": {
                    "must": [
                        { "term": { "parcels.action.transactions.data.assetType": assetType.value } }
                    ],
                    "filter": {
                        "term": {
                            "isRetracted": false
                        }
                    }
                }
            }
        }).then((response: SearchResponse<BlockDoc>) => {
            if (response.hits.total === 0) {
                return null;
            }
            return _.chain(response.hits.hits).flatMap(hit => Block.fromJSON(hit._source).parcels)
                .filter((parcel: SignedParcel) => parcel.unsigned.action instanceof ChangeShardState)
                .flatMap((parcel: SignedParcel) => (parcel.unsigned.action as ChangeShardState).transactions)
                .find((transaction: Transaction) => transaction instanceof AssetMintTransaction && transaction.getAssetSchemeAddress().value === assetType.value)
                .value() as AssetMintTransaction;
        });
    }

    public getBlocksByPlatformAddress = async (address: H160): Promise<Block[]> => {
        return this.searchBlock({
            sort: [
                {
                    "number": { order: "desc" }
                }
            ],
            query: {
                "bool": {
                    "must": {
                        "term": { "author": address.value }
                    },
                    "filter": {
                        "term": {
                            "isRetracted": false
                        }
                    }
                }
            }
        }).then((response: SearchResponse<BlockDoc>) => {
            if (response.hits.total === 0) {
                return [];
            }
            return _.map(response.hits.hits, hit => Block.fromJSON(hit._source));
        });
    }

    public getParcelsByPlatformAddress = async (address: H160): Promise<SignedParcel[]> => {
        return this.searchBlock({
            sort: [
                {
                    "number": { order: "desc" }
                }
            ],
            query: {
                "bool": {
                    "must": {
                        "bool": {
                            "should": [
                                { "term": { "parcels.action.receiver": address.value } },
                                { "term": { "parcels.sender": address.value } }
                            ]
                        }
                    },
                    "filter": {
                        "term": {
                            "isRetracted": false
                        }
                    }
                }
            }
        }).then((response: SearchResponse<BlockDoc>) => {
            if (response.hits.total === 0) {
                return [];
            }
            return _.chain(response.hits.hits).flatMap(hit => hit._source.parcels)
                .filter((parcelDoc: ParcelDoc) => {
                    return (Type.isPaymentDoc(parcelDoc.action) && (parcelDoc.action as PaymentDoc).receiver === address.value) || parcelDoc.sender === address.value;
                }).map(parcelDoc => SignedParcel.fromJSON(parcelDoc)).value();
        });
    }

    public getAssetsByPlatformAddress = async (address: H160): Promise<Asset[]> => {
        return this.searchBlock({
            sort: [
                {
                    "number": { order: "desc" }
                }
            ],
            query: {
                "bool": {
                    "must": {
                        "term": { "parcels.action.transactions.data.registrar": address.value }
                    },
                    "filter": {
                        "term": {
                            "isRetracted": false
                        }
                    }
                }
            }
        }).then((response: SearchResponse<BlockDoc>) => {
            if (response.hits.total === 0) {
                return [];
            }
            return _.chain(response.hits.hits).flatMap(hit => hit._source.parcels)
                .flatMap((parcel: ParcelDoc) => (parcel.action as ChangeShardStateDoc).transactions)
                .filter(transaction => {
                    return Type.isAssetMintTransactionDoc(transaction) && (transaction as AssetMintTransactionDoc).data.registrar === address.value;
                })
                .map((transactionDoc: AssetMintTransactionDoc) => Asset.fromJSON({
                    asset_type: transactionDoc.data.assetType,
                    lock_script_hash: transactionDoc.data.lockScriptHash,
                    parameters: transactionDoc.data.parameters,
                    amount: transactionDoc.data.amount,
                    transactionHash: transactionDoc.data.hash,
                    transactionOutputIndex: 0
                })).value();
        });
    }

    public getTransactionsByAddress = async (address: H256): Promise<Transaction[]> => {
        return this.searchBlock({
            sort: [
                {
                    "number": { order: "desc" }
                }
            ],
            query: {
                "bool": {
                    "must": {
                        "bool": {
                            "should": [
                                { "term": { "parcels.action.transactions.data.outputs.owner": address.value } },
                                { "term": { "parcels.action.transactions.data.inputs.owner": address.value } },
                                { "term": { "parcels.action.transactions.data.owner": address.value } }
                            ]
                        }
                    },
                    "filter": {
                        "term": {
                            "isRetracted": false
                        }
                    }
                }
            }
        }).then((response: SearchResponse<BlockDoc>) => {
            if (response.hits.total === 0) {
                return [];
            }
            return _.chain(response.hits.hits).flatMap(hit => hit._source.parcels)
                .filter((parcel: ParcelDoc) => Type.isChangeShardStateDoc(parcel.action))
                .flatMap((parcel: ParcelDoc) => (parcel.action as ChangeShardStateDoc).transactions)
                .filter(transaction => {
                    if (Type.isAssetTransferTransactionDoc(transaction)) {
                        const transactionDoc = (transaction as AssetTransferTransactionDoc);
                        return _.findIndex(transactionDoc.data.outputs, (output) => output.owner === address.value) !== -1;
                    } else if (Type.isAssetMintTransactionDoc(transaction)) {
                        const transactionDoc = (transaction as AssetMintTransactionDoc);
                        return transactionDoc.data.owner === address.value;
                    }
                    throw new Error("Unexpected transaction")
                })
                .map(transactionDoc => getTransactionFromJSON(transactionDoc))
                .value();
        });
    }

    public getAssetsByAssetAddress = async (address: H160): Promise<Asset[]> => {
        return this.searchBlock({
            sort: [
                {
                    "number": { order: "desc" }
                }
            ],
            query: {
                "bool": {
                    "must": {
                        "bool": {
                            "should": [
                                { "term": { "parcels.action.transactions.data.outputs.owner": address.value } },
                                { "term": { "parcels.action.transactions.data.owner": address.value } }
                            ],
                        }
                    },
                    "filter": {
                        "term": {
                            "isRetracted": false
                        }
                    }
                }
            }
        }).then((response: SearchResponse<BlockDoc>) => {
            if (response.hits.total === 0) {
                return [];
            }
            return _.chain(response.hits.hits).flatMap(hit => hit._source.parcels)
                .filter((parcel: ParcelDoc) => Type.isChangeShardStateDoc(parcel.action))
                .flatMap((parcel: ParcelDoc) => (parcel.action as ChangeShardStateDoc).transactions)
                .flatMap(transaction => {
                    if (Type.isAssetTransferTransactionDoc(transaction)) {
                        return _.chain((transaction as AssetTransferTransactionDoc).data.outputs)
                            .filter(output => output.owner === address.value)
                            .map((output, index) => Asset.fromJSON({
                                asset_type: output.assetType,
                                lock_script_hash: output.lockScriptHash,
                                parameters: output.parameters,
                                amount: output.amount,
                                transactionHash: transaction.data.hash,
                                transactionOutputIndex: index
                            })).value();
                    } else if (Type.isAssetMintTransactionDoc(transaction)) {
                        const transactionDoc = (transaction as AssetMintTransactionDoc);
                        if (transactionDoc.data.owner === address.value) {
                            return Asset.fromJSON({
                                asset_type: transactionDoc.data.assetType,
                                lock_script_hash: transactionDoc.data.lockScriptHash,
                                parameters: transactionDoc.data.parameters,
                                amount: transactionDoc.data.amount,
                                transactionHash: transactionDoc.data.hash,
                                transactionOutputIndex: 0
                            });
                        }
                        return [];
                    }
                    throw new Error("Unexpected transaction")
                }).value();
        });
    }

    public getTransactionInvoice = async (blockHash: H256): Promise<any> => {
        // TODO
        return null;
    }

    public getNonce = async (address: H160): Promise<any> => {
        // TODO
        return null;
    }

    public getBalance = async (address: H160): Promise<any> => {
        // TODO
        return null;
    }

    public getAssetScheme = async (assetType: H256): Promise<AssetScheme> => {
        return this.searchBlock({
            sort: [
                {
                    "number": { order: "desc" }
                }
            ],
            query: {
                "bool": {
                    "must": [
                        { "term": { "parcels.action.transactions.data.assetType": assetType.value } }
                    ],
                    "filter": {
                        "term": {
                            "isRetracted": false
                        }
                    }
                }
            }
        }).then((response: SearchResponse<BlockDoc>) => {
            if (response.hits.total === 0) {
                return null;
            }
            const assetMintTransaction = _.chain(response.hits.hits).flatMap(hit => Block.fromJSON(hit._source).parcels)
                .filter((parcel: SignedParcel) => parcel.unsigned.action instanceof ChangeShardState)
                .flatMap((parcel: SignedParcel) => (parcel.unsigned.action as ChangeShardState).transactions)
                .find((transaction: Transaction) => transaction instanceof AssetMintTransaction && transaction.getAssetSchemeAddress().value === assetType.value)
                .value() as AssetMintTransaction;
            return assetMintTransaction.getAssetScheme();
        });
    }

    public checkIndexOrCreate = async (): Promise<void> => {
        const mappingBlockJson = require("./mapping_block.json");
        const isMappingBlockExisted = await this.client.indices.exists({ index: "block" });
        if (!isMappingBlockExisted) {
            await this.client.indices.create({
                index: "block"
            });
            await this.client.indices.putMapping({
                index: "block",
                type: "_doc",
                body: mappingBlockJson
            });
        }
    }

    public addBlock = async (block: Block): Promise<void> => {
        return this.indexBlock(block);
    }

    public retractBlock = async (blockHash: H256): Promise<void> => {
        return this.updateBlock(blockHash, { "isRetracted": true }).then(() => {
            console.log("%s block is retracted", blockHash.value);
        });
    }

    private searchBlock(body: any): Promise<void | SearchResponse<any>> {
        return this.client.search({
            index: "block",
            type: "_doc",
            body
        }).catch((err) => {
            console.error('Elastic search error %s', err);
        });
    }

    private indexBlock = async (block: Block): Promise<any> => {
        const blockDoc: BlockDoc = await Converter.fromBlock(block, this);
        return this.client.index({
            index: "block",
            type: "_doc",
            id: block.hash.value,
            body: blockDoc,
            refresh: "wait_for"
        }).catch((err) => {
            console.error('Elastic search index error %s', err);
        });
    }

    private updateBlock(hash: H256, partial: any): Promise<any> {
        return this.client.update({
            index: "block",
            type: "_doc",
            id: hash.value,
            refresh: "wait_for",
            body: {
                doc: partial
            }
        }).catch((err) => {
            console.error('Elastic search update error %s', err);
        });
    }
}