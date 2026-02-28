# frozen_string_literal: true

# Raised when an order cannot be fulfilled due to insufficient inventory.
class InsufficientInventoryError < StandardError
  def initialize(product_id, requested, available)
    super("Product #{product_id}: requested #{requested}, available #{available}")
    @product_id = product_id
    @requested = requested
    @available = available
  end

  attr_reader :product_id, :requested, :available
end

# Processes customer orders: validates inventory, applies discounts, charges payment.
class OrderProcessor
  DISCOUNT_THRESHOLD = 100.0

  def initialize(inventory_service, payment_gateway, notifier)
    @inventory = inventory_service
    @payment = payment_gateway
    @notifier = notifier
  end

  # Process a complete order. Returns the order receipt or raises on failure.
  def process(order)
    validate_inventory(order)
    total = calculate_total(order)
    charge = @payment.charge(order.customer_id, total, order.currency)
    @inventory.reserve(order.items)
    @notifier.send_confirmation(order.customer_id, charge.transaction_id)
    { transaction_id: charge.transaction_id, total: total }
  end

  # Cancel a previously placed order and issue a refund.
  def cancel(order_id)
    order = find_order(order_id)
    @payment.refund(order.transaction_id)
    @inventory.release(order.items)
    @notifier.send_cancellation(order.customer_id)
    true
  end

  private

  def validate_inventory(order)
    order.items.each do |item|
      available = @inventory.available_quantity(item.product_id)
      if item.quantity > available
        raise InsufficientInventoryError.new(item.product_id, item.quantity, available)
      end
    end
  end

  def calculate_total(order)
    subtotal = order.items.sum { |item| item.price * item.quantity }
    subtotal > DISCOUNT_THRESHOLD ? subtotal * 0.95 : subtotal
  end

  def find_order(order_id)
    raise ArgumentError, "Order #{order_id} not found"
  end
end
