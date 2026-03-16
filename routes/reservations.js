var express = require('express');
var router = express.Router();
let reservationController = require('../controllers/reservations')
let { checkLogin } = require('../utils/authHandler.js')

router.get('/', checkLogin, async function (req, res, next) {
    let reservations = await reservationController.GetReservationsOfUser(req.userId)
    res.send(reservations)
})

router.get('/:id', checkLogin, async function (req, res, next) {
    try {
        let reservation = await reservationController.GetReservationDetail(req.params.id, req.userId)
        if (!reservation) {
            res.status(404).send({ message: 'reservation not found' })
            return
        }
        res.send(reservation)
    } catch (error) {
        res.status(404).send({ message: 'reservation not found' })
    }
})

router.post('/reserveACart', checkLogin, async function (req, res, next) {
    try {
        let reservation = await reservationController.ReserveACart(req.userId)
        res.send(reservation)
    } catch (error) {
        res.status(400).send({ message: error.message })
    }
})

router.post('/reserveItems', checkLogin, async function (req, res, next) {
    try {
        let items = []
        if (Array.isArray(req.body)) {
            items = req.body
        } else {
            items = req.body.list || req.body.items || req.body.products || []
        }
        let reservation = await reservationController.ReserveItems(req.userId, items)
        res.send(reservation)
    } catch (error) {
        res.status(400).send({ message: error.message })
    }
})

router.post('/cancelReserve/:id', checkLogin, async function (req, res, next) {
    try {
        let reservation = await reservationController.CancelReserve(req.params.id, req.userId)
        res.send(reservation)
    } catch (error) {
        res.status(400).send({ message: error.message })
    }
})

module.exports = router;