import { NextApiRequest, NextApiResponse } from 'next';
import { DexService } from '../../../services/DexService';

const dexService = new DexService();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { tokenIn, tokenOut, amount } = req.body;

    if (!tokenIn || !tokenOut || !amount) {
      return res.status(400).json({ message: 'Missing required parameters' });
    }

    const quote = dexService.calculateOptimalSwap(
      tokenIn,
      tokenOut,
      BigInt(amount)
    );

    return res.status(200).json(quote);
  } catch (error) {
    console.error('Error in DEX quote:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
} 