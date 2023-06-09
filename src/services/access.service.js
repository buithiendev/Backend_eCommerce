'use strict'
const shopModel = require('../models/shop.model')
const bcrypt = require('bcrypt')
const crypto = require('crypto')
const { createTokenPair, verifyJWT } = require('../auth/authUtils')
const KeyTokenService = require('./keyToken.service')
const { RoleShop } = require('../constants')
const { getInfoData, createKeys } = require('../utils')
const { BadRequestError, ConflictRequestError, AuthFailureError, ForbiddenError } = require('../core/error.response')

//service
const ShopService = require('../services/shop.service')

class AccessService {
    static handlerRefreshToken = async (refreshToken) => {
        const foundToken = await KeyTokenService.findByRefreshTokenUsed(refreshToken)

        if (foundToken) {
            const { userId, email } = await verifyJWT(refreshToken, foundToken.privateKey)

            //
            await KeyTokenService.deleteKeyByUserId(userId)
            throw new ForbiddenError('Something wrong happend. Please relogin')
        }

        const holderToken = await KeyTokenService.findByRefreshToken(refreshToken)
        if (!holderToken) throw new AuthFailureError('Shop not registered')

        // verify Token

        const { userId, email } = await verifyJWT(refreshToken, holderToken.privateKey)

        const foundShop = await ShopService.findByEmail({ email })
        if (!foundShop) throw new AuthFailureError('Shop not registered')

        // create double token
        const tokens = await createTokenPair({ userId, email }, holderToken.publicKey, holderToken.privateKey)

        // update token
        await holderToken.updateOne({
            $set: {
                refreshToken: tokens.refreshToken,
            },
            $addToSet: {
                refreshTokensUsed: refreshToken,
            },
        })

        return {
            user: { userId, email },
            tokens,
        }
    }

    static handlerRefreshTokenV2 = async ({ refreshToken, user, keyStore }) => {
        const { userId, email } = user

        if (keyStore.refreshTokensUsed.includes(refreshToken)) {
            await KeyTokenService.deleteKeyByUserId(userId)
            throw new ForbiddenError('Something wrong happend. Please relogin')
        }

        if (keyStore.refreshToken !== refreshToken) throw new AuthFailureError('Shop not registered')

        const foundShop = await ShopService.findByEmail({ email })
        if (!foundShop) throw new AuthFailureError('Shop not registered')

        const tokens = await createTokenPair({ userId, email }, keyStore.publicKey, keyStore.privateKey)

        await keyStore.updateOne({
            $set: {
                refreshToken: tokens.refreshToken,
            },
            $addToSet: {
                refreshTokensUsed: refreshToken,
            },
        })

        return {
            user: { userId, email },
            tokens,
        }
    }

    static logout = async ({ keyStore }) => {
        const deleteKey = await KeyTokenService.removeToken(keyStore._id)

        return deleteKey
    }

    static login = async ({ email, password, refereshToken = null }) => {
        const foundShop = await ShopService.findByEmail({ email })
        if (!foundShop) {
            throw new BadRequestError('Shop is not registered')
        }

        const match = bcrypt.compare(password, foundShop.password)
        if (!match) {
            throw new AuthFailureError('Authentication Error')
        }

        const { privateKey, publicKey } = createKeys()

        const { _id: userId } = foundShop
        const tokens = await createTokenPair({ userId, email }, publicKey, privateKey)

        await KeyTokenService.createKeyToken({
            refreshToken: tokens.refreshToken,
            privateKey,
            publicKey,
            userId,
        })

        return {
            shop: getInfoData({ fields: ['_id', 'name', 'email'], object: foundShop }),
            tokens,
        }
    }

    static signUpRSA = async ({ name, email, password }) => {
        const existsShop = await ShopService.findByEmail({ email })
        if (existsShop) {
            throw new BadRequestError('Shop is already registered')
        }

        const passwordHash = await bcrypt.hash(password, 10)

        const newShop = await shopModel.create({
            name,
            email,
            password: passwordHash,
            roles: [RoleShop.SHOP],
        })

        if (newShop) {
            // Created privateKy, publicKey
            const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
                modulusLength: 4096,
                publicKeyEncoding: {
                    type: 'pkcs1',
                    format: 'pem',
                },
                privateKeyEncoding: {
                    type: 'pkcs1',
                    format: 'pem',
                },
            })
            // Public key CryptoGraphy Standards!

            const publicKeyString = await KeyTokenService.createKeyToken({
                userId: newShop._id,
                publicKey,
            })

            if (!publicKeyString) {
                throw new BadRequestError('publicKeyString error')
            }

            const publicKeyObject = crypto.createPublicKey(publicKeyString)

            const tokens = await createTokenPair({ userId: newShop._id, email }, publicKeyObject, privateKey)

            return {
                shop: getInfoData({
                    fields: ['_id', 'name', 'email'],
                    object: newShop,
                }),
                tokens,
            }
            return null
        }
    }

    static signUp = async ({ name, email, password }) => {
        const existsShop = await ShopService.findByEmail({ email })
        if (existsShop) {
            throw new BadRequestError('Shop is already registered')
        }

        const passwordHash = await bcrypt.hash(password, 10)

        const newShop = await shopModel.create({
            name,
            email,
            password: passwordHash,
            roles: [RoleShop.SHOP],
        })

        if (newShop) {
            // Created privateKy, publicKey
            const { privateKey, publicKey } = createKeys()
            // Public key CryptoGraphy Standards!
            const keyStore = await KeyTokenService.createKeyToken({
                userId: newShop._id,
                publicKey,
                privateKey,
            })

            if (!keyStore) {
                throw new BadRequestError('KeyStore error')
            }

            const tokens = await createTokenPair({ userId: newShop._id, email }, publicKey, privateKey)

            return {
                shop: getInfoData({
                    fields: ['_id', 'name', 'email'],
                    object: newShop,
                }),
                tokens,
            }
        }
        return null
    }
}

module.exports = AccessService
