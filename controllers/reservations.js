let mongoose = require('mongoose')
let reservationModel = require('../schemas/reservations')
let cartModel = require('../schemas/cart')
let productModel = require('../schemas/products')
let inventoryModel = require('../schemas/inventories')

let RESERVATION_EXPIRE_MS = 30 * 60 * 1000

async function buildReservationItems(rawItems, session) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        throw new Error('Danh sach san pham khong hop le')
    }

    let normalizedItems = rawItems.map(function (item) {
        return {
            product: item.product,
            quantity: Number(item.quantity)
        }
    })

    let mergedMap = new Map()
    for (const item of normalizedItems) {
        if (!item.product || !Number.isInteger(item.quantity) || item.quantity <= 0) {
            throw new Error('Danh sach san pham khong hop le')
        }

        let productId = item.product.toString()
        if (!mergedMap.has(productId)) {
            mergedMap.set(productId, {
                product: productId,
                quantity: item.quantity
            })
        } else {
            mergedMap.get(productId).quantity += item.quantity
        }
    }

    let productIds = Array.from(mergedMap.keys()).map(function (id) {
        return new mongoose.Types.ObjectId(id)
    })

    let [products, inventories] = await Promise.all([
        productModel.find({ _id: { $in: productIds }, isDeleted: false }).session(session),
        inventoryModel.find({ product: { $in: productIds } }).session(session)
    ])

    if (products.length !== productIds.length || inventories.length !== productIds.length) {
        throw new Error('San pham khong ton tai hoac khong co ton kho')
    }

    let productMap = new Map(products.map(function (product) {
        return [product._id.toString(), product]
    }))
    let inventoryMap = new Map(inventories.map(function (inventory) {
        return [inventory.product.toString(), inventory]
    }))

    let reservationItems = []
    let totalAmount = 0

    for (const [productId, item] of mergedMap.entries()) {
        let product = productMap.get(productId)
        let inventory = inventoryMap.get(productId)

        if (!product || !inventory) {
            throw new Error('San pham khong ton tai hoac khong co ton kho')
        }

        let availableStock = inventory.stock - inventory.reserved
        if (availableStock < item.quantity) {
            throw new Error('So luong ton kho khong du')
        }

        let subtotal = product.price * item.quantity
        inventory.reserved += item.quantity
        await inventory.save({ session })

        reservationItems.push({
            product: product._id,
            quantity: item.quantity,
            price: product.price,
            subtotal: subtotal
        })
        totalAmount += subtotal
    }

    return {
        items: reservationItems,
        totalAmount: totalAmount
    }
}

module.exports = {
    GetReservationsOfUser: async function (userId) {
        return await reservationModel.find({ user: userId })
            .populate('items.product')
            .sort({ createdAt: -1 })
    },
    GetReservationDetail: async function (reservationId, userId) {
        return await reservationModel.findOne({
            _id: reservationId,
            user: userId
        }).populate('items.product')
    },
    ReserveACart: async function (userId) {
        let session = await mongoose.startSession()
        try {
            await session.startTransaction()
            let currentCart = await cartModel.findOne({ user: userId }).session(session)
            if (!currentCart || currentCart.items.length === 0) {
                throw new Error('Gio hang trong')
            }

            let reservationData = await buildReservationItems(currentCart.items, session)
            let newReservation = new reservationModel({
                user: userId,
                items: reservationData.items,
                totalAmount: reservationData.totalAmount,
                ExpiredAt: new Date(Date.now() + RESERVATION_EXPIRE_MS)
            })

            let savedReservation = await newReservation.save({ session })
            currentCart.items = []
            await currentCart.save({ session })
            await session.commitTransaction()

            return await reservationModel.findById(savedReservation._id)
                .populate('items.product')
        } catch (error) {
            await session.abortTransaction()
            throw error
        } finally {
            session.endSession()
        }
    },
    ReserveItems: async function (userId, rawItems) {
        let session = await mongoose.startSession()
        try {
            await session.startTransaction()
            let reservationData = await buildReservationItems(rawItems, session)
            let newReservation = new reservationModel({
                user: userId,
                items: reservationData.items,
                totalAmount: reservationData.totalAmount,
                ExpiredAt: new Date(Date.now() + RESERVATION_EXPIRE_MS)
            })

            let savedReservation = await newReservation.save({ session })
            await session.commitTransaction()

            return await reservationModel.findById(savedReservation._id)
                .populate('items.product')
        } catch (error) {
            await session.abortTransaction()
            throw error
        } finally {
            session.endSession()
        }
    },
    CancelReserve: async function (reservationId, userId) {
        let reservation = await reservationModel.findOne({
            _id: reservationId,
            user: userId
        })

        if (!reservation) {
            throw new Error('Khong tim thay reservation')
        }

        if (reservation.status !== 'actived') {
            throw new Error('Reservation khong the huy')
        }

        for (const item of reservation.items) {
            let inventory = await inventoryModel.findOne({ product: item.product })
            if (!inventory) {
                throw new Error('Khong tim thay ton kho cua san pham')
            }

            inventory.reserved = Math.max(0, inventory.reserved - item.quantity)
            await inventory.save()
        }

        reservation.status = 'cancelled'
        await reservation.save()
        return await reservation.populate('items.product')
    }
}