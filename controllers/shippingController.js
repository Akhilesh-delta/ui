const Shipping = require('../models/Shipping');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Store = require('../models/Store');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

class ShippingController {
  // ===============================
  // SHIPPING METHODS MANAGEMENT
  // ===============================

  // Create shipping method
  createShippingMethod = catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      name,
      description,
      type = 'standard',
      carrier = 'custom',
      serviceLevel = 'ground',
      estimatedDays = 5,
      isActive = true,
      conditions = {},
      rates = [],
      restrictions = {},
      tracking = {}
    } = req.body;

    const shippingMethod = new Shipping({
      name,
      description,
      type,
      carrier,
      serviceLevel,
      estimatedDays,
      isActive,
      conditions: {
        minWeight: 0,
        maxWeight: 100,
        minValue: 0,
        maxValue: 10000,
        ...conditions
      },
      rates: rates.map(rate => ({
        zone: rate.zone,
        weight: rate.weight,
        rate: rate.rate,
        currency: rate.currency || 'USD'
      })),
      restrictions: {
        allowedCountries: [],
        excludedCountries: [],
        allowedProducts: [],
        excludedProducts: [],
        ...restrictions
      },
      tracking: {
        url: tracking.url,
        apiKey: tracking.apiKey,
        enabled: tracking.enabled || false
      },
      createdBy: req.user.id
    });

    await shippingMethod.save();

    logger.info('Shipping method created', {
      shippingMethodId: shippingMethod._id,
      name,
      carrier,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Shipping method created successfully',
      data: shippingMethod
    });
  });

  // Get shipping methods
  getShippingMethods = catchAsync(async (req, res) => {
    const {
      type,
      carrier,
      isActive = true,
      page = 1,
      limit = 20,
      sortBy = 'name'
    } = req.query;

    let query = {};

    if (type) query.type = type;
    if (carrier) query.carrier = carrier;
    if (isActive) query.isActive = true;

    let sort = {};
    sort[sortBy] = 1;

    const shippingMethods = await Shipping.find(query)
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Shipping.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        shippingMethods,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalMethods: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Update shipping method
  updateShippingMethod = catchAsync(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const shippingMethod = await Shipping.findById(id);

    if (!shippingMethod) {
      throw new AppError('Shipping method not found', 404, true, 'SHIPPING_METHOD_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to update shipping methods', 403, true, 'NOT_AUTHORIZED');
    }

    // Update fields
    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        shippingMethod[key] = updates[key];
      }
    });

    shippingMethod.updatedBy = req.user.id;
    await shippingMethod.save();

    logger.info('Shipping method updated', {
      shippingMethodId: id,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Shipping method updated successfully',
      data: shippingMethod
    });
  });

  // Delete shipping method
  deleteShippingMethod = catchAsync(async (req, res) => {
    const { id } = req.params;

    const shippingMethod = await Shipping.findById(id);

    if (!shippingMethod) {
      throw new AppError('Shipping method not found', 404, true, 'SHIPPING_METHOD_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to delete shipping methods', 403, true, 'NOT_AUTHORIZED');
    }

    await Shipping.findByIdAndDelete(id);

    logger.info('Shipping method deleted', {
      shippingMethodId: id,
      deletedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Shipping method deleted successfully'
    });
  });

  // ===============================
  // SHIPPING RATE CALCULATIONS
  // ===============================

  // Calculate shipping rates
  calculateShippingRates = catchAsync(async (req, res) => {
    const { cartId, shippingAddress, items } = req.body;

    if (!shippingAddress) {
      throw new AppError('Shipping address is required', 400, true, 'SHIPPING_ADDRESS_REQUIRED');
    }

    let cartItems = items;
    if (cartId) {
      const cart = await require('../models/Cart').findById(cartId);
      if (!cart) {
        throw new AppError('Cart not found', 404, true, 'CART_NOT_FOUND');
      }
      cartItems = cart.items;
    }

    const shippingOptions = await this.calculateShippingOptions(cartItems, shippingAddress);

    res.status(200).json({
      success: true,
      data: {
        shippingOptions,
        address: shippingAddress,
        itemCount: cartItems.length
      }
    });
  });

  // Calculate shipping options
  async calculateShippingOptions(items, shippingAddress) {
    const options = [];

    // Get all active shipping methods
    const shippingMethods = await Shipping.find({ isActive: true });

    for (const method of shippingMethods) {
      const rate = await this.calculateShippingRate(items, shippingAddress, method);

      if (rate !== null) {
        options.push({
          method: method._id,
          name: method.name,
          description: method.description,
          carrier: method.carrier,
          serviceLevel: method.serviceLevel,
          estimatedDays: method.estimatedDays,
          rate: rate.rate,
          currency: rate.currency,
          tracking: method.tracking.enabled,
          conditions: method.conditions,
          restrictions: method.restrictions
        });
      }
    }

    // Sort by rate
    return options.sort((a, b) => a.rate - b.rate);
  });

  // Calculate shipping rate for specific method
  async calculateShippingRate(items, shippingAddress, method) {
    // Check restrictions
    if (!this.checkShippingRestrictions(items, shippingAddress, method)) {
      return null;
    }

    // Calculate total weight and value
    const totalWeight = items.reduce((sum, item) => sum + (item.weight || 0.5) * item.quantity, 0);
    const totalValue = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    // Check conditions
    if (totalWeight < method.conditions.minWeight || totalWeight > method.conditions.maxWeight) {
      return null;
    }

    if (totalValue < method.conditions.minValue || totalValue > method.conditions.maxValue) {
      return null;
    }

    // Find appropriate rate
    let rate = null;
    for (const shippingRate of method.rates) {
      if (totalWeight <= shippingRate.weight) {
        rate = {
          rate: shippingRate.rate,
          currency: shippingRate.currency
        };
        break;
      }
    }

    // If no rate found, use the highest rate
    if (!rate && method.rates.length > 0) {
      rate = {
        rate: method.rates[method.rates.length - 1].rate,
        currency: method.rates[method.rates.length - 1].currency
      };
    }

    return rate;
  }

  // Check shipping restrictions
  checkShippingRestrictions(items, shippingAddress, method) {
    // Check country restrictions
    if (method.restrictions.excludedCountries.includes(shippingAddress.country)) {
      return false;
    }

    if (method.restrictions.allowedCountries.length > 0 &&
        !method.restrictions.allowedCountries.includes(shippingAddress.country)) {
      return false;
    }

    // Check product restrictions
    for (const item of items) {
      if (method.restrictions.excludedProducts.includes(item.product)) {
        return false;
      }

      if (method.restrictions.allowedProducts.length > 0 &&
          !method.restrictions.allowedProducts.includes(item.product)) {
        return false;
      }
    }

    return true;
  }

  // ===============================
  // SHIPPING ZONES & REGIONS
  // ===============================

  // Create shipping zone
  createShippingZone = catchAsync(async (req, res) => {
    const { name, countries, regions, rates } = req.body;

    const shippingZone = new ShippingZone({
      name,
      countries,
      regions,
      rates: rates.map(rate => ({
        weight: rate.weight,
        rate: rate.rate,
        currency: rate.currency || 'USD'
      })),
      createdBy: req.user.id
    });

    await shippingZone.save();

    logger.info('Shipping zone created', {
      shippingZoneId: shippingZone._id,
      name,
      countries: countries.length,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Shipping zone created successfully',
      data: shippingZone
    });
  });

  // Get shipping zones
  getShippingZones = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, sortBy = 'name' } = req.query;

    let sort = {};
    sort[sortBy] = 1;

    const shippingZones = await ShippingZone.find({})
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await ShippingZone.countDocuments();

    res.status(200).json({
      success: true,
      data: {
        shippingZones,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalZones: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Update shipping zone
  updateShippingZone = catchAsync(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const shippingZone = await ShippingZone.findById(id);

    if (!shippingZone) {
      throw new AppError('Shipping zone not found', 404, true, 'SHIPPING_ZONE_NOT_FOUND');
    }

    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        shippingZone[key] = updates[key];
      }
    });

    shippingZone.updatedBy = req.user.id;
    await shippingZone.save();

    logger.info('Shipping zone updated', {
      shippingZoneId: id,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Shipping zone updated successfully',
      data: shippingZone
    });
  });

  // ===============================
  // SHIPPING TRACKING
  // ===============================

  // Track shipment
  trackShipment = catchAsync(async (req, res) => {
    const { trackingNumber } = req.params;

    if (!trackingNumber) {
      throw new AppError('Tracking number is required', 400, true, 'TRACKING_NUMBER_REQUIRED');
    }

    const trackingInfo = await this.getTrackingInfo(trackingNumber);

    res.status(200).json({
      success: true,
      data: {
        trackingNumber,
        trackingInfo
      }
    });
  });

  // Get tracking info
  async getTrackingInfo(trackingNumber) {
    // This would integrate with shipping carriers' APIs
    // For now, return mock data
    return {
      status: 'in_transit',
      location: 'New York, NY',
      estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      events: [
        {
          status: 'picked_up',
          location: 'Los Angeles, CA',
          timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          description: 'Package picked up by carrier'
        },
        {
          status: 'in_transit',
          location: 'Chicago, IL',
          timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          description: 'Package in transit to destination'
        }
      ]
    };
  }

  // Update shipment tracking
  updateShipmentTracking = catchAsync(async (req, res) => {
    const { orderId } = req.params;
    const { trackingNumber, carrier, status, location } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Update tracking information
    order.shipping.tracking = {
      number: trackingNumber,
      carrier,
      status,
      location,
      updatedAt: new Date()
    };

    await order.save();

    // Send tracking update notification
    await this.sendTrackingNotification(order, req.user.id);

    logger.info('Shipment tracking updated', {
      orderId,
      trackingNumber,
      status,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Shipment tracking updated successfully',
      data: order.shipping
    });
  });

  // ===============================
  // SHIPPING LABELS
  // ===============================

  // Generate shipping label
  generateShippingLabel = catchAsync(async (req, res) => {
    const { orderId } = req.params;
    const { carrier, serviceLevel } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Check permissions
    if (order.items[0].vendor.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to generate shipping labels for this order', 403, true, 'NOT_AUTHORIZED');
    }

    const labelData = await this.createShippingLabel(order, carrier, serviceLevel);

    // Update order with tracking info
    order.shipping.label = {
      trackingNumber: labelData.trackingNumber,
      labelUrl: labelData.labelUrl,
      carrier,
      serviceLevel,
      generatedAt: new Date()
    };

    await order.save();

    logger.info('Shipping label generated', {
      orderId,
      trackingNumber: labelData.trackingNumber,
      carrier,
      generatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Shipping label generated successfully',
      data: labelData
    });
  });

  // Create shipping label
  async createShippingLabel(order, carrier, serviceLevel) {
    // This would integrate with shipping carriers' APIs
    // For now, return mock data
    const trackingNumber = 'TRK' + Date.now().toString().slice(-8);

    return {
      trackingNumber,
      labelUrl: `/api/shipping/labels/${trackingNumber}.pdf`,
      carrier,
      serviceLevel,
      cost: 8.99
    };
  }

  // Get shipping label
  getShippingLabel = catchAsync(async (req, res) => {
    const { trackingNumber } = req.params;

    // This would return the actual PDF label
    // For now, return mock data
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="label-${trackingNumber}.pdf"`);

    // In a real implementation, this would return the actual PDF
    res.status(200).send('Mock PDF content');
  });

  // ===============================
  // SHIPPING ANALYTICS
  // ===============================

  // Get shipping analytics
  getShippingAnalytics = catchAsync(async (req, res) => {
    const { dateRange = 30, vendorId } = req.query;

    const startDate = new Date(Date.now() - parseInt(dateRange) * 24 * 60 * 60 * 1000);

    let query = { orderedAt: { $gte: startDate } };

    if (vendorId) {
      query['items.vendor'] = vendorId;
    }

    const analytics = await this.generateShippingAnalytics(query, parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: analytics
    });
  });

  // Generate shipping analytics
  async generateShippingAnalytics(query, dateRange) {
    const orders = await Order.find(query);

    const totalShipments = orders.length;
    const totalShippingCost = orders.reduce((sum, order) => sum + (order.shipping.cost || 0), 0);
    const averageShippingCost = totalShipments > 0 ? totalShippingCost / totalShipments : 0;

    // Shipping method breakdown
    const methodBreakdown = await this.getShippingMethodBreakdown(orders);

    // Delivery performance
    const deliveryPerformance = await this.getDeliveryPerformance(orders);

    // Cost analysis
    const costAnalysis = await this.getShippingCostAnalysis(orders);

    return {
      period: `${dateRange} days`,
      overview: {
        totalShipments,
        totalShippingCost: Math.round(totalShippingCost * 100) / 100,
        averageShippingCost: Math.round(averageShippingCost * 100) / 100
      },
      methodBreakdown,
      deliveryPerformance,
      costAnalysis,
      trends: await this.getShippingTrends(dateRange)
    };
  }

  // Get shipping method breakdown
  async getShippingMethodBreakdown(orders) {
    const breakdown = {};

    orders.forEach(order => {
      const method = order.shipping.method || 'standard';
      if (breakdown[method]) {
        breakdown[method].count++;
        breakdown[method].cost += order.shipping.cost || 0;
      } else {
        breakdown[method] = {
          count: 1,
          cost: order.shipping.cost || 0
        };
      }
    });

    return Object.keys(breakdown).map(method => ({
      method,
      count: breakdown[method].count,
      cost: Math.round(breakdown[method].cost * 100) / 100,
      percentage: Math.round((breakdown[method].count / orders.length) * 100)
    }));
  }

  // Get delivery performance
  async getDeliveryPerformance(orders) {
    const deliveredOrders = orders.filter(order => order.shipping.status === 'delivered');

    if (deliveredOrders.length === 0) {
      return {
        onTimeDelivery: 0,
        averageDeliveryTime: 0,
        deliveryAccuracy: 0
      };
    }

    const onTimeDeliveries = deliveredOrders.filter(order =>
      order.shipping.deliveredAt <= order.shipping.estimatedDelivery
    ).length;

    const totalDeliveryTime = deliveredOrders.reduce((sum, order) => {
      const deliveryTime = order.shipping.deliveredAt - order.shipping.shippedAt;
      return sum + deliveryTime;
    }, 0);

    return {
      onTimeDelivery: Math.round((onTimeDeliveries / deliveredOrders.length) * 100),
      averageDeliveryTime: Math.round(totalDeliveryTime / deliveredOrders.length / (24 * 60 * 60 * 1000)),
      deliveryAccuracy: Math.round((onTimeDeliveries / deliveredOrders.length) * 100)
    };
  }

  // Get shipping cost analysis
  async getShippingCostAnalysis(orders) {
    const costs = orders.map(order => order.shipping.cost || 0);
    const sortedCosts = costs.sort((a, b) => a - b);

    return {
      average: Math.round((costs.reduce((sum, cost) => sum + cost, 0) / costs.length) * 100) / 100,
      median: sortedCosts[Math.floor(sortedCosts.length / 2)],
      minimum: Math.min(...costs),
      maximum: Math.max(...costs),
      total: Math.round(costs.reduce((sum, cost) => sum + cost, 0) * 100) / 100
    };
  }

  // Get shipping trends
  async getShippingTrends(dateRange) {
    // Mock implementation for trends
    return Array.from({ length: dateRange }, (_, i) => ({
      date: new Date(Date.now() - (dateRange - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      shipments: Math.floor(Math.random() * 50) + 20,
      cost: Math.round((Math.random() * 500 + 200) * 100) / 100
    }));
  }

  // ===============================
  // SHIPPING NOTIFICATIONS
  // ===============================

  // Send shipping notification
  sendShippingNotification = catchAsync(async (req, res) => {
    const { orderId } = req.params;
    const { type, message } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    await this.sendShippingUpdateNotification(order, type, message);

    res.status(200).json({
      success: true,
      message: 'Shipping notification sent successfully'
    });
  });

  // Send shipping update notification
  async sendShippingUpdateNotification(order, type, customMessage) {
    const notifications = [];

    // Notify customer
    if (order.user) {
      notifications.push(Notification.createNotification(order.user, {
        type: 'shipping',
        category: 'transactional',
        title: this.getShippingNotificationTitle(type),
        message: customMessage || this.getShippingNotificationMessage(type, order),
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          trackingNumber: order.shipping.tracking?.number
        },
        priority: 'normal',
        actions: [
          {
            type: 'link',
            label: 'Track Package',
            url: `/orders/${order._id}/track`,
            action: 'track_package'
          }
        ]
      }));
    }

    // Notify vendor
    const vendors = [...new Set(order.items.map(item => item.vendor.toString()))];
    for (const vendorId of vendors) {
      notifications.push(Notification.createNotification(vendorId, {
        type: 'shipping',
        category: 'transactional',
        title: `Order ${order.orderNumber} - ${this.getShippingNotificationTitle(type)}`,
        message: customMessage || this.getShippingNotificationMessage(type, order),
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber
        },
        priority: 'normal'
      }));
    }

    await Promise.all(notifications);
  }

  // Get shipping notification title
  getShippingNotificationTitle(type) {
    const titles = {
      'shipped': 'Your Order Has Shipped!',
      'in_transit': 'Package In Transit',
      'out_for_delivery': 'Out for Delivery',
      'delivered': 'Package Delivered',
      'delivery_attempted': 'Delivery Attempted',
      'exception': 'Delivery Exception',
      'returned': 'Package Returned'
    };

    return titles[type] || 'Shipping Update';
  }

  // Get shipping notification message
  getShippingNotificationMessage(type, order) {
    const messages = {
      'shipped': `Your order ${order.orderNumber} has been shipped and is on its way!`,
      'in_transit': `Your package for order ${order.orderNumber} is in transit.`,
      'out_for_delivery': `Your package for order ${order.orderNumber} is out for delivery today.`,
      'delivered': `Your order ${order.orderNumber} has been delivered successfully.`,
      'delivery_attempted': `We attempted to deliver your order ${order.orderNumber} but couldn't complete the delivery.`,
      'exception': `There was an issue with the delivery of your order ${order.orderNumber}.`,
      'returned': `Your order ${order.orderNumber} has been returned to sender.`
    };

    return messages[type] || `There is an update on your order ${order.orderNumber}.`;
  }

  // ===============================
  // SHIPPING CARRIERS
  // ===============================

  // Get shipping carriers
  getShippingCarriers = catchAsync(async (req, res) => {
    const carriers = await Shipping.getActiveCarriers();

    res.status(200).json({
      success: true,
      data: carriers
    });
  });

  // Add shipping carrier
  addShippingCarrier = catchAsync(async (req, res) => {
    const { name, apiKey, apiSecret, isActive = true, settings = {} } = req.body;

    const carrier = {
      name,
      apiKey,
      apiSecret,
      isActive,
      settings,
      addedAt: new Date(),
      addedBy: req.user.id
    };

    // Add to carriers collection
    await Shipping.addCarrier(carrier);

    logger.info('Shipping carrier added', {
      carrier: name,
      addedBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Shipping carrier added successfully',
      data: carrier
    });
  });

  // Update shipping carrier
  updateShippingCarrier = catchAsync(async (req, res) => {
    const { carrierId } = req.params;
    const updates = req.body;

    await Shipping.updateCarrier(carrierId, updates);

    logger.info('Shipping carrier updated', {
      carrierId,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Shipping carrier updated successfully'
    });
  });

  // ===============================
  // SHIPPING RESTRICTIONS
  // ===============================

  // Create shipping restriction
  createShippingRestriction = catchAsync(async (req, res) => {
    const { name, type, countries, products, rules } = req.body;

    const restriction = new ShippingRestriction({
      name,
      type,
      countries,
      products,
      rules,
      createdBy: req.user.id
    });

    await restriction.save();

    logger.info('Shipping restriction created', {
      restrictionId: restriction._id,
      name,
      type,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Shipping restriction created successfully',
      data: restriction
    });
  });

  // Get shipping restrictions
  getShippingRestrictions = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, type } = req.query;

    let query = {};
    if (type) query.type = type;

    const restrictions = await ShippingRestriction.find(query)
      .sort({ name: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await ShippingRestriction.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        restrictions,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalRestrictions: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // ===============================
  // SHIPPING INSURANCE
  // ===============================

  // Calculate shipping insurance
  calculateShippingInsurance = catchAsync(async (req, res) => {
    const { orderValue, shippingMethod } = req.body;

    const insuranceOptions = await this.getInsuranceOptions(orderValue, shippingMethod);

    res.status(200).json({
      success: true,
      data: {
        orderValue,
        insuranceOptions
      }
    });
  });

  // Get insurance options
  async getInsuranceOptions(orderValue, shippingMethod) {
    const options = [
      {
        provider: 'ship_insure',
        name: 'Basic Coverage',
        cost: Math.round(orderValue * 0.01 * 100) / 100, // 1% of order value
        coverage: orderValue,
        deductible: 50
      },
      {
        provider: 'ship_insure',
        name: 'Premium Coverage',
        cost: Math.round(orderValue * 0.02 * 100) / 100, // 2% of order value
        coverage: orderValue * 1.5,
        deductible: 25
      },
      {
        provider: 'upsure',
        name: 'Complete Protection',
        cost: Math.round(orderValue * 0.015 * 100) / 100, // 1.5% of order value
        coverage: orderValue * 2,
        deductible: 0
      }
    ];

    return options;
  }

  // Add shipping insurance
  addShippingInsurance = catchAsync(async (req, res) => {
    const { orderId } = req.params;
    const { provider, coverageType, cost } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    order.shipping.insurance = {
      provider,
      coverageType,
      cost,
      coverage: order.pricing.totalAmount,
      purchasedAt: new Date()
    };

    await order.save();

    logger.info('Shipping insurance added', {
      orderId,
      provider,
      cost,
      addedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Shipping insurance added successfully',
      data: order.shipping.insurance
    });
  });

  // ===============================
  // SHIPPING RETURNS
  // ===============================

  // Create return shipping label
  createReturnShippingLabel = catchAsync(async (req, res) => {
    const { orderId } = req.params;
    const { reason, items } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Check if return is allowed
    if (!order.returnPolicy?.returnable) {
      throw new AppError('Returns not allowed for this order', 400, true, 'RETURNS_NOT_ALLOWED');
    }

    const returnLabel = await this.generateReturnLabel(order, reason, items);

    // Update order with return info
    order.shipping.returnLabel = {
      trackingNumber: returnLabel.trackingNumber,
      labelUrl: returnLabel.labelUrl,
      reason,
      items,
      generatedAt: new Date()
    };

    await order.save();

    logger.info('Return shipping label generated', {
      orderId,
      trackingNumber: returnLabel.trackingNumber,
      reason,
      generatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Return shipping label generated successfully',
      data: returnLabel
    });
  });

  // Generate return label
  async generateReturnLabel(order, reason, items) {
    const trackingNumber = 'RTN' + Date.now().toString().slice(-8);

    return {
      trackingNumber,
      labelUrl: `/api/shipping/returns/${trackingNumber}.pdf`,
      reason,
      items,
      instructions: 'Please package items securely and attach this label to the outside of the package.'
    };
  });

  // ===============================
  // MULTI-VENDOR SHIPPING
  // ===============================

  // Get multi-vendor shipping options
  getMultiVendorShippingOptions = catchAsync(async (req, res) => {
    const { cartId } = req.params;

    const cart = await require('../models/Cart').findById(cartId);

    if (!cart) {
      throw new AppError('Cart not found', 404, true, 'CART_NOT_FOUND');
    }

    const shippingOptions = await this.calculateMultiVendorShipping(cart);

    res.status(200).json({
      success: true,
      data: {
        cart: cart.getCartSummary(),
        shippingOptions,
        vendorBreakdown: await this.getVendorShippingBreakdown(cart)
      }
    });
  });

  // Calculate multi-vendor shipping
  async calculateMultiVendorShipping(cart) {
    const vendorGroups = {};

    // Group items by vendor
    cart.items.forEach(item => {
      const vendorId = item.vendor.toString();
      if (!vendorGroups[vendorId]) {
        vendorGroups[vendorId] = {
          vendor: vendorId,
          items: [],
          totalWeight: 0,
          totalValue: 0
        };
      }

      vendorGroups[vendorId].items.push(item);
      vendorGroups[vendorId].totalWeight += (item.weight || 0.5) * item.quantity;
      vendorGroups[vendorId].totalValue += item.price * item.quantity;
    });

    const shippingOptions = [];

    // Calculate shipping for each vendor group
    for (const vendorGroup of Object.values(vendorGroups)) {
      const vendorOptions = await this.calculateShippingOptions(vendorGroup.items, cart.shipping.address);

      shippingOptions.push({
        vendor: vendorGroup.vendor,
        options: vendorOptions
      });
    }

    return shippingOptions;
  }

  // Get vendor shipping breakdown
  async getVendorShippingBreakdown(cart) {
    const breakdown = [];

    // Group by vendor
    const vendorGroups = {};
    cart.items.forEach(item => {
      const vendorId = item.vendor.toString();
      if (!vendorGroups[vendorId]) {
        vendorGroups[vendorId] = {
          vendor: vendorId,
          items: [],
          totalValue: 0,
          totalWeight: 0
        };
      }

      vendorGroups[vendorId].items.push(item);
      vendorGroups[vendorId].totalValue += item.price * item.quantity;
      vendorGroups[vendorId].totalWeight += (item.weight || 0.5) * item.quantity;
    });

    for (const vendorGroup of Object.values(vendorGroups)) {
      const vendor = await User.findById(vendorGroup.vendor);
      const store = await Store.findOne({ owner: vendorGroup.vendor });

      breakdown.push({
        vendor: {
          id: vendorGroup.vendor,
          name: vendor?.firstName + ' ' + vendor?.lastName,
          store: store?.name
        },
        itemCount: vendorGroup.items.length,
        totalValue: Math.round(vendorGroup.totalValue * 100) / 100,
        totalWeight: Math.round(vendorGroup.totalWeight * 100) / 100,
        items: vendorGroup.items.map(item => ({
          productId: item.product,
          name: item.name,
          quantity: item.quantity,
          weight: item.weight || 0.5
        }))
      });
    }

    return breakdown;
  }

  // ===============================
  // SHIPPING OPTIMIZATION
  // ===============================

  // Optimize shipping costs
  optimizeShippingCosts = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { preferences = {} } = req.body;

    const cart = await require('../models/Cart').findById(cartId);

    if (!cart) {
      throw new AppError('Cart not found', 404, true, 'CART_NOT_FOUND');
    }

    const optimizations = await this.getShippingOptimizations(cart, preferences);

    res.status(200).json({
      success: true,
      data: {
        cart: cart.getCartSummary(),
        optimizations,
        potentialSavings: await this.calculatePotentialSavings(optimizations)
      }
    });
  });

  // Get shipping optimizations
  async getShippingOptimizations(cart, preferences) {
    const optimizations = [];

    // Free shipping threshold
    const freeShippingThreshold = preferences.freeShippingThreshold || 50;
    const currentTotal = cart.pricing.subtotal;
    const remainingForFree = Math.max(0, freeShippingThreshold - currentTotal);

    if (remainingForFree > 0) {
      optimizations.push({
        type: 'free_shipping',
        description: `Add $${remainingForFree.toFixed(2)} more to get free shipping`,
        potentialSavings: 5.99,
        actions: [
          {
            type: 'add_items',
            amount: remainingForFree,
            description: 'Add items to qualify for free shipping'
          }
        ]
      });
    }

    // Shipping method optimization
    const currentMethod = cart.shipping.method;
    const cheaperMethods = await this.findCheaperShippingMethods(cart);

    if (cheaperMethods.length > 0) {
      optimizations.push({
        type: 'cheaper_shipping',
        description: 'Switch to a more cost-effective shipping method',
        potentialSavings: currentMethod ?
          cart.shipping.cost - cheaperMethods[0].rate : cheaperMethods[0].rate,
        actions: cheaperMethods.map(method => ({
          type: 'switch_method',
          method: method.name,
          cost: method.rate,
          savings: currentMethod ? cart.shipping.cost - method.rate : method.rate
        }))
      });
    }

    // Consolidation optimization
    const consolidationSavings = await this.getConsolidationSavings(cart);
    if (consolidationSavings > 0) {
      optimizations.push({
        type: 'consolidation',
        description: 'Combine orders to save on shipping',
        potentialSavings: consolidationSavings,
        actions: [
          {
            type: 'combine_orders',
            description: 'Combine with other pending orders'
          }
        ]
      });
    }

    return optimizations;
  }

  // Find cheaper shipping methods
  async findCheaperShippingMethods(cart) {
    const shippingOptions = await this.calculateShippingOptions(cart.items, cart.shipping.address);

    return shippingOptions
      .filter(option => option.rate < (cart.shipping.cost || 999))
      .slice(0, 3);
  }

  // Get consolidation savings
  async getConsolidationSavings(cart) {
    // Check for pending orders from same vendors
    const pendingOrders = await Order.find({
      user: cart.user,
      status: { $in: ['pending', 'processing'] },
      'items.vendor': { $in: cart.items.map(item => item.vendor) }
    });

    if (pendingOrders.length > 0) {
      return 3.99; // Mock savings
    }

    return 0;
  }

  // Calculate potential savings
  async calculatePotentialSavings(optimizations) {
    return optimizations.reduce((sum, opt) => sum + opt.potentialSavings, 0);
  }

  // ===============================
  // SHIPPING API INTEGRATIONS
  // ===============================

  // Get shipping API status
  getShippingAPIStatus = catchAsync(async (req, res) => {
    const apiStatus = {
      ups: await this.checkUPSAPI(),
      fedex: await this.checkFedExAPI(),
      usps: await this.checkUSPSAPI(),
      dhl: await this.checkDHLAPI()
    };

    res.status(200).json({
      success: true,
      data: apiStatus
    });
  });

  // Check UPS API
  async checkUPSAPI() {
    // Mock API check
    return {
      status: 'connected',
      lastChecked: new Date(),
      responseTime: 150
    };
  }

  // Check FedEx API
  async checkFedExAPI() {
    // Mock API check
    return {
      status: 'connected',
      lastChecked: new Date(),
      responseTime: 200
    };
  }

  // Check USPS API
  async checkUSPSAPI() {
    // Mock API check
    return {
      status: 'connected',
      lastChecked: new Date(),
      responseTime: 300
    };
  }

  // Check DHL API
  async checkDHLAPI() {
    // Mock API check
    return {
      status: 'connected',
      lastChecked: new Date(),
      responseTime: 250
    };
  }

  // ===============================
  // SHIPPING REPORTS
  // ===============================

  // Get shipping performance report
  getShippingPerformanceReport = catchAsync(async (req, res) => {
    const { dateRange = 30, format = 'json' } = req.query;

    const report = await this.generateShippingPerformanceReport(parseInt(dateRange));

    if (format === 'csv') {
      const csvData = this.generateShippingReportCSV(report);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="shipping-report.csv"`);
      res.status(200).send(csvData);
    } else {
      res.status(200).json({
        success: true,
        data: report
      });
    }
  });

  // Generate shipping performance report
  async generateShippingPerformanceReport(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const orders = await Order.find({
      'shipping.status': { $ne: 'not_shipped' },
      orderedAt: { $gte: startDate }
    });

    return {
      period: `${dateRange} days`,
      generatedAt: new Date(),
      summary: {
        totalShipments: orders.length,
        totalShippingCost: orders.reduce((sum, order) => sum + (order.shipping.cost || 0), 0),
        averageShippingCost: orders.length > 0 ?
          orders.reduce((sum, order) => sum + (order.shipping.cost || 0), 0) / orders.length : 0
      },
      performance: await this.getDeliveryPerformance(orders),
      costs: await this.getShippingCostAnalysis(orders),
      trends: await this.getShippingTrends(dateRange),
      byCarrier: await this.getShippingByCarrier(orders),
      byRegion: await this.getShippingByRegion(orders)
    };
  }

  // Get shipping by carrier
  async getShippingByCarrier(orders) {
    const carrierStats = {};

    orders.forEach(order => {
      const carrier = order.shipping.carrier || 'unknown';
      if (carrierStats[carrier]) {
        carrierStats[carrier].count++;
        carrierStats[carrier].cost += order.shipping.cost || 0;
      } else {
        carrierStats[carrier] = {
          count: 1,
          cost: order.shipping.cost || 0
        };
      }
    });

    return Object.keys(carrierStats).map(carrier => ({
      carrier,
      shipments: carrierStats[carrier].count,
      cost: Math.round(carrierStats[carrier].cost * 100) / 100
    }));
  }

  // Get shipping by region
  async getShippingByRegion(orders) {
    const regionStats = {};

    orders.forEach(order => {
      const region = order.shipping.address?.country || 'unknown';
      if (regionStats[region]) {
        regionStats[region].count++;
        regionStats[region].cost += order.shipping.cost || 0;
      } else {
        regionStats[region] = {
          count: 1,
          cost: order.shipping.cost || 0
        };
      }
    });

    return Object.keys(regionStats).map(region => ({
      region,
      shipments: regionStats[region].count,
      cost: Math.round(regionStats[region].cost * 100) / 100
    }));
  }

  // Generate shipping report CSV
  generateShippingReportCSV(report) {
    // Implementation for CSV generation
    return 'shipping report data...';
  }

  // ===============================
  // SHIPPING UTILITIES
  // ===============================

  // Validate shipping address
  validateShippingAddress = catchAsync(async (req, res) => {
    const { address } = req.body;

    if (!address) {
      throw new AppError('Address is required', 400, true, 'ADDRESS_REQUIRED');
    }

    const validation = await this.validateAddress(address);

    res.status(200).json({
      success: true,
      data: {
        address,
        isValid: validation.isValid,
        normalized: validation.normalized,
        suggestions: validation.suggestions
      }
    });
  });

  // Validate address
  async validateAddress(address) {
    // Mock address validation
    return {
      isValid: true,
      normalized: address,
      suggestions: []
    };
  }

  // Estimate delivery date
  estimateDeliveryDate = catchAsync(async (req, res) => {
    const { shippingMethod, origin, destination } = req.body;

    const estimate = await this.calculateDeliveryEstimate(shippingMethod, origin, destination);

    res.status(200).json({
      success: true,
      data: estimate
    });
  });

  // Calculate delivery estimate
  async calculateDeliveryEstimate(shippingMethod, origin, destination) {
    const baseDays = {
      'standard': 5,
      'express': 2,
      'overnight': 1
    };

    const processingDays = 1;
    const totalDays = processingDays + (baseDays[shippingMethod] || 5);

    return {
      method: shippingMethod,
      estimatedDays: totalDays,
      estimatedDate: new Date(Date.now() + totalDays * 24 * 60 * 60 * 1000),
      guaranteed: shippingMethod === 'overnight'
    };
  }

  // Get shipping rates for product
  getProductShippingRates = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { destination, quantity = 1 } = req.query;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    if (!destination) {
      throw new AppError('Destination address is required', 400, true, 'DESTINATION_REQUIRED');
    }

    const items = [{
      product: productId,
      name: product.name,
      price: product.price,
      quantity: parseInt(quantity),
      weight: product.shipping?.weight || 0.5,
      vendor: product.vendor
    }];

    const shippingOptions = await this.calculateShippingOptions(items, JSON.parse(destination));

    res.status(200).json({
      success: true,
      data: {
        product: product.name,
        quantity: parseInt(quantity),
        destination: JSON.parse(destination),
        shippingOptions
      }
    });
  });

  // ===============================
  // SHIPPING CONFIGURATION
  // ===============================

  // Get shipping configuration
  getShippingConfiguration = catchAsync(async (req, res) => {
    const configuration = {
      defaultShippingMethod: 'standard',
      freeShippingThreshold: 50,
      maxWeightPerPackage: 70,
      supportedCountries: ['US', 'CA', 'UK', 'AU'],
      restrictedItems: ['hazardous', 'perishable'],
      carriers: await Shipping.getActiveCarriers(),
      zones: await ShippingZone.find({}).select('name countries'),
      methods: await Shipping.find({ isActive: true }).select('name type carrier')
    };

    res.status(200).json({
      success: true,
      data: configuration
    });
  });

  // Update shipping configuration
  updateShippingConfiguration = catchAsync(async (req, res) => {
    const updates = req.body;

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to update shipping configuration', 403, true, 'NOT_AUTHORIZED');
    }

    // Update configuration
    await this.saveShippingConfiguration(updates);

    logger.info('Shipping configuration updated', {
      updatedBy: req.user.id,
      updates: Object.keys(updates)
    });

    res.status(200).json({
      success: true,
      message: 'Shipping configuration updated successfully',
      data: updates
    });
  });

  // Save shipping configuration
  async saveShippingConfiguration(configuration) {
    // Implementation for saving configuration
    // This would typically save to a configuration collection or file
  }

  // ===============================
  // SHIPPING DASHBOARD
  // ===============================

  // Get shipping dashboard
  getShippingDashboard = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const dashboard = {
      summary: await this.getShippingSummary(parseInt(dateRange)),
      pendingShipments: await this.getPendingShipments(),
      recentActivity: await this.getRecentShippingActivity(),
      alerts: await this.getShippingAlerts(),
      performance: await this.getShippingPerformance(parseInt(dateRange))
    };

    res.status(200).json({
      success: true,
      data: dashboard
    });
  });

  // Get shipping summary
  async getShippingSummary(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const totalShipments = await Order.countDocuments({
      'shipping.status': { $ne: 'not_shipped' },
      orderedAt: { $gte: startDate }
    });

    const shippedToday = await Order.countDocuments({
      'shipping.shippedAt': {
        $gte: new Date(new Date().setHours(0, 0, 0, 0)),
        $lt: new Date(new Date().setHours(23, 59, 59, 999))
      }
    });

    return {
      totalShipments,
      shippedToday,
      averageShippingCost: 8.99,
      onTimeDelivery: 94.5
    };
  }

  // Get pending shipments
  async getPendingShipments() {
    const pendingOrders = await Order.find({
      status: { $in: ['processing', 'ready'] },
      'shipping.status': 'not_shipped'
    })
    .limit(10)
    .select('orderNumber items.shipping createdAt');

    return pendingOrders;
  }

  // Get recent shipping activity
  async getRecentShippingActivity() {
    const recentOrders = await Order.find({
      'shipping.status': { $ne: 'not_shipped' }
    })
    .sort({ 'shipping.updatedAt': -1 })
    .limit(10)
    .select('orderNumber shipping.status shipping.tracking.number updatedAt');

    return recentOrders;
  }

  // Get shipping alerts
  async getShippingAlerts() {
    const alerts = [];

    // Check for delayed shipments
    const delayedShipments = await Order.find({
      'shipping.estimatedDelivery': { $lt: new Date() },
      'shipping.status': { $nin: ['delivered', 'returned'] }
    });

    if (delayedShipments.length > 0) {
      alerts.push({
        type: 'warning',
        title: 'Delayed Shipments',
        message: `${delayedShipments.length} shipments are past their estimated delivery date`,
        count: delayedShipments.length
      });
    }

    // Check for high shipping costs
    const highCostShipments = await Order.find({
      'shipping.cost': { $gt: 20 },
      orderedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    if (highCostShipments.length > 0) {
      alerts.push({
        type: 'info',
        title: 'High Shipping Costs',
        message: `${highCostShipments.length} shipments had high shipping costs today`,
        count: highCostShipments.length
      });
    }

    return alerts;
  }

  // Get shipping performance
  async getShippingPerformance(dateRange) {
    return {
      onTimeDelivery: 94.5,
      averageDeliveryTime: 4.2,
      costEfficiency: 87.3,
      customerSatisfaction: 4.6
    };
  }

  // ===============================
  // SHIPPING BULK OPERATIONS
  // ===============================

  // Bulk update shipping status
  bulkUpdateShippingStatus = catchAsync(async (req, res) => {
    const { orderIds, status, trackingNumbers = [] } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      throw new AppError('Order IDs array is required', 400, true, 'INVALID_ORDER_IDS');
    }

    let updated = 0;
    let errors = [];

    for (let i = 0; i < orderIds.length; i++) {
      try {
        const order = await Order.findById(orderIds[i]);

        if (order) {
          order.shipping.status = status;

          if (status === 'shipped') {
            order.shipping.shippedAt = new Date();
          } else if (status === 'delivered') {
            order.shipping.deliveredAt = new Date();
          }

          if (trackingNumbers[i]) {
            order.shipping.tracking = {
              number: trackingNumbers[i],
              status,
              updatedAt: new Date()
            };
          }

          await order.save();
          updated++;

          // Send notification
          await this.sendShippingUpdateNotification(order, status);
        }
      } catch (error) {
        errors.push({
          orderId: orderIds[i],
          error: error.message
        });
      }
    }

    logger.info('Shipping status bulk updated', {
      updated,
      errors: errors.length,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Shipping status updated successfully',
      data: {
        updated,
        errors,
        status
      }
    });
  });

  // Bulk generate shipping labels
  bulkGenerateShippingLabels = catchAsync(async (req, res) => {
    const { orderIds, carrier, serviceLevel } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      throw new AppError('Order IDs array is required', 400, true, 'INVALID_ORDER_IDS');
    }

    let generated = 0;
    let errors = [];

    for (const orderId of orderIds) {
      try {
        const order = await Order.findById(orderId);

        if (order) {
          const labelData = await this.createShippingLabel(order, carrier, serviceLevel);

          order.shipping.label = {
            trackingNumber: labelData.trackingNumber,
            labelUrl: labelData.labelUrl,
            carrier,
            serviceLevel,
            generatedAt: new Date()
          };

          await order.save();
          generated++;

          logger.info('Shipping label generated', {
            orderId,
            trackingNumber: labelData.trackingNumber,
            carrier
          });
        }
      } catch (error) {
        errors.push({
          orderId,
          error: error.message
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Shipping labels generated successfully',
      data: {
        generated,
        errors,
        carrier,
        serviceLevel
      }
    });
  });

  // ===============================
  // SHIPPING MAINTENANCE
  // ===============================

  // Clean up old shipping data
  cleanupShippingData = catchAsync(async (req, res) => {
    const { daysOld = 90 } = req.query;

    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to cleanup shipping data', 403, true, 'NOT_AUTHORIZED');
    }

    const cutoffDate = new Date(Date.now() - parseInt(daysOld) * 24 * 60 * 60 * 1000);

    // Archive old shipping records
    const result = await Order.updateMany(
      {
        'shipping.deliveredAt': { $lt: cutoffDate },
        'shipping.status': 'delivered'
      },
      {
        $set: {
          'shipping.archived': true,
          'shipping.archivedAt': new Date()
        }
      }
    );

    logger.info('Shipping data cleaned up', {
      adminId: req.user.id,
      archivedCount: result.modifiedCount,
      daysOld
    });

    res.status(200).json({
      success: true,
      message: 'Shipping data cleaned up successfully',
      data: {
        archivedCount: result.modifiedCount
      }
    });
  });

  // Optimize shipping performance
  optimizeShippingPerformance = catchAsync(async (req, res) => {
    // Check permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to optimize shipping', 403, true, 'NOT_AUTHORIZED');
    }

    const optimizations = {
      cacheCleared: await this.clearShippingCache(),
      ratesUpdated: await this.updateShippingRates(),
      zonesOptimized: await this.optimizeShippingZones(),
      carriersValidated: await this.validateCarrierIntegrations()
    };

    logger.info('Shipping performance optimized', {
      adminId: req.user.id,
      optimizations: Object.keys(optimizations)
    });

    res.status(200).json({
      success: true,
      message: 'Shipping performance optimized successfully',
      data: optimizations
    });
  });

  // Clear shipping cache
  async clearShippingCache() {
    // Implementation for clearing shipping cache
    return true;
  }

  // Update shipping rates
  async updateShippingRates() {
    // Implementation for updating shipping rates
    return true;
  }

  // Optimize shipping zones
  async optimizeShippingZones() {
    // Implementation for optimizing shipping zones
    return true;
  }

  // Validate carrier integrations
  async validateCarrierIntegrations() {
    // Implementation for validating carrier integrations
    return true;
  }

  // ===============================
  // SHIPPING UTILITIES
  // ===============================

  // Get shipping method by ID
  getShippingMethod = catchAsync(async (req, res) => {
    const { id } = req.params;

    const shippingMethod = await Shipping.findById(id);

    if (!shippingMethod) {
      throw new AppError('Shipping method not found', 404, true, 'SHIPPING_METHOD_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: shippingMethod
    });
  });

  // Get shipping zones by country
  getShippingZonesByCountry = catchAsync(async (req, res) => {
    const { country } = req.params;

    const zones = await ShippingZone.find({
      countries: country
    });

    res.status(200).json({
      success: true,
      data: {
        country,
        zones
      }
    });
  });

  // Get shipping cost breakdown
  getShippingCostBreakdown = catchAsync(async (req, res) => {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    const breakdown = {
      baseShipping: order.shipping.cost || 0,
      fuelSurcharge: Math.round((order.shipping.cost || 0) * 0.05 * 100) / 100,
      insurance: order.shipping.insurance?.cost || 0,
      handling: 1.99,
      taxes: Math.round((order.shipping.cost || 0) * 0.08 * 100) / 100,
      total: 0
    };

    breakdown.total = Object.values(breakdown).reduce((sum, cost) => sum + cost, 0);

    res.status(200).json({
      success: true,
      data: {
        order: order.orderNumber,
        breakdown
      }
    });
  });

  // Compare shipping options
  compareShippingOptions = catchAsync(async (req, res) => {
    const { cartId, address } = req.body;

    const cart = await require('../models/Cart').findById(cartId);

    if (!cart) {
      throw new AppError('Cart not found', 404, true, 'CART_NOT_FOUND');
    }

    const comparison = await this.generateShippingComparison(cart, address);

    res.status(200).json({
      success: true,
      data: comparison
    });
  });

  // Generate shipping comparison
  async generateShippingComparison(cart, address) {
    const options = await this.calculateShippingOptions(cart.items, address);

    return {
      cart: cart.getCartSummary(),
      address,
      options,
      recommendations: await this.getShippingRecommendations(options),
      costSavings: await this.calculateShippingSavings(options)
    };
  }

  // Get shipping recommendations
  async getShippingRecommendations(options) {
    const cheapest = options.reduce((min, option) => option.rate < min.rate ? option : min, options[0]);
    const fastest = options.reduce((fastest, option) => option.estimatedDays < fastest.estimatedDays ? option : fastest, options[0]);

    return {
      cheapest,
      fastest,
      bestValue: options.find(option => option.rate < cheapest.rate * 1.5 && option.estimatedDays <= fastest.estimatedDays + 1) || cheapest
    };
  }

  // Calculate shipping savings
  async calculateShippingSavings(options) {
    if (options.length < 2) return 0;

    const cheapest = Math.min(...options.map(option => option.rate));
    const mostExpensive = Math.max(...options.map(option => option.rate));

    return Math.round((mostExpensive - cheapest) * 100) / 100;
  }

  // ===============================
  // SHIPPING WEBHOOKS
  // ===============================

  // Handle shipping webhook
  handleShippingWebhook = catchAsync(async (req, res) => {
    const { carrier, event, trackingNumber, data } = req.body;

    // Process webhook event
    await this.processShippingWebhook(carrier, event, trackingNumber, data);

    res.status(200).json({
      success: true,
      message: 'Webhook processed successfully'
    });
  });

  // Process shipping webhook
  async processShippingWebhook(carrier, event, trackingNumber, data) {
    // Find order by tracking number
    const order = await Order.findOne({
      'shipping.tracking.number': trackingNumber
    });

    if (order) {
      // Update order status
      await this.updateOrderFromWebhook(order, carrier, event, data);

      // Send notifications
      await this.sendShippingUpdateNotification(order, event);

      logger.info('Shipping webhook processed', {
        orderId: order._id,
        carrier,
        event,
        trackingNumber
      });
    }
  });

  // Update order from webhook
  async updateOrderFromWebhook(order, carrier, event, data) {
    const statusMapping = {
      'package_accepted': 'accepted',
      'in_transit': 'in_transit',
      'out_for_delivery': 'out_for_delivery',
      'delivered': 'delivered',
      'exception': 'exception',
      'returned': 'returned'
    };

    const newStatus = statusMapping[event];

    if (newStatus) {
      order.shipping.status = newStatus;
      order.shipping.tracking = {
        ...order.shipping.tracking,
        status: newStatus,
        location: data.location,
        updatedAt: new Date()
      };

      if (newStatus === 'delivered') {
        order.shipping.deliveredAt = new Date();
      }

      await order.save();
    }
  }

  // ===============================
  // SHIPPING EXPORT/IMPORT
  // ===============================

  // Export shipping data
  exportShippingData = catchAsync(async (req, res) => {
    const { format = 'json', dateFrom, dateTo } = req.query;

    let query = {};
    if (dateFrom || dateTo) {
      query.orderedAt = {};
      if (dateFrom) query.orderedAt.$gte = new Date(dateFrom);
      if (dateTo) query.orderedAt.$lte = new Date(dateTo);
    }

    const orders = await Order.find(query)
      .select('orderNumber shipping createdAt')
      .sort({ createdAt: -1 });

    const exportData = {
      orders,
      exportedAt: new Date(),
      exportedBy: req.user.id,
      totalRecords: orders.length
    };

    if (format === 'csv') {
      const csvData = this.generateShippingExportCSV(orders);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="shipping-export.csv"`);
      res.status(200).send(csvData);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="shipping-export.json"`);
      res.status(200).json(exportData);
    }
  });

  // Generate shipping export CSV
  generateShippingExportCSV(orders) {
    const headers = ['Order Number', 'Shipping Method', 'Carrier', 'Tracking Number', 'Status', 'Cost', 'Shipped Date'];
    const rows = orders.map(order => [
      order.orderNumber,
      order.shipping.method || '',
      order.shipping.carrier || '',
      order.shipping.tracking?.number || '',
      order.shipping.status || '',
      order.shipping.cost || '',
      order.shipping.shippedAt || ''
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  // ===============================
  // SHIPPING VALIDATION
  // ===============================

  // Validate shipping method
  validateShippingMethod = catchAsync(async (req, res) => {
    const { methodId } = req.params;
    const { items, address } = req.body;

    const shippingMethod = await Shipping.findById(methodId);

    if (!shippingMethod) {
      throw new AppError('Shipping method not found', 404, true, 'SHIPPING_METHOD_NOT_FOUND');
    }

    const validation = {
      isValid: true,
      errors: [],
      warnings: [],
      rate: null
    };

    // Check restrictions
    const restrictionCheck = this.checkShippingRestrictions(items, address, shippingMethod);
    if (!restrictionCheck) {
      validation.isValid = false;
      validation.errors.push('Shipping restrictions not met');
    }

    // Calculate rate
    if (validation.isValid) {
      validation.rate = await this.calculateShippingRate(items, address, shippingMethod);
    }

    // Check for warnings
    if (validation.rate && validation.rate.rate > 20) {
      validation.warnings.push('High shipping cost detected');
    }

    res.status(200).json({
      success: true,
      data: {
        method: shippingMethod.name,
        validation
      }
    });
  });

  // ===============================
  // SHIPPING UTILITIES
  // ===============================

  // Get shipping method by name
  getShippingMethodByName = catchAsync(async (req, res) => {
    const { name } = req.params;

    const shippingMethod = await Shipping.findOne({
      name: { $regex: `^${name}$`, $options: 'i' }
    });

    if (!shippingMethod) {
      throw new AppError('Shipping method not found', 404, true, 'SHIPPING_METHOD_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: shippingMethod
    });
  });

  // Get shipping statistics
  getShippingStatistics = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const stats = await this.generateShippingStatistics(parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: stats
    });
  });

  // Generate shipping statistics
  async generateShippingStatistics(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const orders = await Order.find({
      orderedAt: { $gte: startDate },
      'shipping.status': { $ne: 'not_shipped' }
    });

    return {
      period: `${dateRange} days`,
      totalShipments: orders.length,
      totalCost: orders.reduce((sum, order) => sum + (order.shipping.cost || 0), 0),
      averageCost: orders.length > 0 ?
        orders.reduce((sum, order) => sum + (order.shipping.cost || 0), 0) / orders.length : 0,
      byStatus: await this.getShippingByStatus(orders),
      byCarrier: await this.getShippingByCarrier(orders),
      performance: await this.getDeliveryPerformance(orders)
    };
  }

  // Get shipping by status
  async getShippingByStatus(orders) {
    const statusStats = {};

    orders.forEach(order => {
      const status = order.shipping.status || 'unknown';
      statusStats[status] = (statusStats[status] || 0) + 1;
    });

    return Object.keys(statusStats).map(status => ({
      status,
      count: statusStats[status]
    }));
  }

  // Send tracking notification
  async sendTrackingNotification(order, userId) {
    // Notify customer
    if (userId) {
      await Notification.createNotification(userId, {
        type: 'shipping',
        category: 'transactional',
        title: 'Tracking Information Updated',
        message: `Your order ${order.orderNumber} tracking has been updated. Status: ${order.shipping.status}`,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          trackingNumber: order.shipping.tracking?.number,
          status: order.shipping.status
        },
        priority: 'normal',
        actions: [
          {
            type: 'link',
            label: 'Track Package',
            url: `/orders/${order._id}/track`,
            action: 'track_package'
          }
        ]
      });
    }
  }
}

module.exports = new ShippingController();
