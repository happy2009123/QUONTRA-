import { useState } from 'react';
import { cn } from '@/lib/cn';
import { X } from 'lucide-react';

export interface TradeTicketProps {
  instrumentId: string;
  onPlace: (params: {
    instrumentId: string;
    direction: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LOSS' | 'TAKE_PROFIT';
    quantity: number;
    price?: number;
  }) => Promise<void>;
  onClose: () => void;
}

export function TradeTicket({ instrumentId, onPlace, onClose }: TradeTicketProps) {
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LOSS' | 'TAKE_PROFIT'>('MARKET');
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(0);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const submit = async () => {
    setFeedback(null);
    setLoading(true);
    if (orderType !== 'MARKET' && !(price > 0)) {
      setFeedback({ kind: 'error', text: 'A positive limit/trigger price is required' });
      setLoading(false);
      return;
    }
    try {
      await onPlace({
        instrumentId,
        direction,
        orderType,
        quantity: Number(quantity),
        price: orderType !== 'MARKET' ? Number(price) : undefined,
      });
      setFeedback({
        kind: 'success',
        text: `Order placed: ${direction} ${quantity}${price > 0 ? ` @ ₹${price}` : ''}`,
      });
      setTimeout(() => setFeedback(null), 6000);
      onClose();
    } catch {
      setFeedback({ kind: 'error', text: 'Network error placing order' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center pt-16">
      <div className="pop-in relative w-full max-w-lg mx-4 sm:max-w-md bg-panel rounded-lg border border-line shadow-xl p-6">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">Place Order</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-mut transition-[background-color,color,scale] duration-150 ease-out hover:bg-panel hover:text-fg motion-safe:active:scale-95 focus-visible:outline-2 focus-visible:outline-gold/70">
            <X size={16} aria-hidden />
          </button>
        </header>
        <form className="mt-4 space-y-4">
          <div>
            <label className="block text-[11px] uppercase text-mut-2 mb-1">Direction</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDirection('BUY')}
                className={cn('flex-1 rounded-pL bg-gold/10 text-gold-2', direction === 'BUY' ? 'bg-gold/20 text-gold' : '')}
              >
                BUY
              </button>
              <button
                type="button"
                onClick={() => setDirection('SELL')}
                className={cn('flex-1 rounded-r bg-panel text-mut', direction === 'SELL' ? 'bg-gold/10 text-gold' : '')}
              >
                SELL
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[11px] uppercase text-mut-2 mb-1">Order Type</label>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as any)}
              className="w-full rounded-[4px] border border-line py-2 text-[12px] text-fg focus-visible:outline-2 focus-visible:outline-gold/70 focus-visible:outline-offset-1"
            >
              <option value="MARKET">Market</option>
              <option value="LIMIT">Limit</option>
              <option value="STOP">Stop</option>
              <option value="STOP_LOSS">Stop-loss</option>
              <option value="TAKE_PROFIT">Take-profit</option>
            </select>
          </div>
          {orderType !== 'MARKET' && (
            <div>
              <label className="block text-[11px] uppercase text-mut-2 mb-1">Price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                className="w-full rounded-[4px] border border-line py-2 text-[12px] text-fg focus-visible:outline-2 focus-visible:outline-gold/70 focus-visible:outline-offset-1"
                placeholder="0"
              />
            </div>
          )}
          <div>
            <label className="block text-[11px] uppercase text-mut-2 mb-1">Quantity</label>
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value) || 1)}
              className="w-full rounded-[4px] border border-line py-2 text-[12px] text-fg focus-visible:outline-2 focus-visible:outline-gold/70 focus-visible:outline-offset-1"
              placeholder="1"
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-[4px] bg-gold text-[14px] font-medium py-3 transition-colors hover:bg-gold-2 motion-safe:active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-gold/70"
              onClick={submit}
            >
              {loading ? 'Sending…' : 'Place Order'}
            </button>
          </div>
          {feedback && (
            <div className="mt-3 p-3 rounded text-sm {
              feedback.kind === 'success' ? 'bg-panel/90 text-gold' : 'bg-neg/10 text-neg'
            }">
              {feedback.text}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}