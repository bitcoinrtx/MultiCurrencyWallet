import BigInteger from 'bigi'

import { BigNumber } from 'bignumber.js'
import * as bitcoin from 'bitcoinjs-lib'
import * as bip32 from 'bip32'
import * as bip39 from 'bip39'

import bitcoinMessage from 'bitcoinjs-message'
import { getState } from 'redux/core'
import reducers from 'redux/core/reducers'
import { btc, apiLooper, constants, api } from 'helpers'
import actions from 'redux/actions'
import typeforce from 'swap.app/util/typeforce'
import config from 'app-config'

import { localisePrefix } from 'helpers/locale'

import { default as mnemonicUtils } from '../../../../common/utils/mnemonic'


const hasAdminFee = (config
  && config.opts
  && config.opts.fee
  && config.opts.fee.btc
  && config.opts.fee.btc.fee
  && config.opts.fee.btc.address
  && config.opts.fee.btc.min
) ? config.opts.fee.btc : false

const getRandomMnemonicWords = () => bip39.generateMnemonic()
const validateMnemonicWords = (mnemonic) => bip39.validateMnemonic(convertMnemonicToValid(mnemonic))


const sweepToMnemonic = (mnemonic, path) => {
  const wallet = getWalletByWords(mnemonic, path)
  localStorage.setItem(constants.privateKeyNames.btcMnemonic, wallet.WIF)
  return wallet.WIF
}

const getMainPublicKey = () => {
  const {
    user: {
      btcData,
    },
  } = getState()

  return btcData.publicKey.toString('Hex')
}

const isSweeped = () => {
  const {
    user: {
      btcData,
      btcMnemonicData,
    },
  } = getState()

  if (btcMnemonicData
    && btcMnemonicData.address
    && btcData
    && btcData.address
    && btcData.address.toLowerCase() !== btcMnemonicData.address.toLowerCase()
  ) return false

  return true
}

const getSweepAddress = () => {
  const {
    user: {
      btcMnemonicData,
    },
  } = getState()

  if (btcMnemonicData && btcMnemonicData.address) return btcMnemonicData.address
  return false
}

const convertMnemonicToValid = (mnemonic) => mnemonicUtils.convertMnemonicToValid(mnemonic)

const getWalletByWords = (mnemonic, walletNumber = 0, path) => {
  return mnemonicUtils.getBtcWallet(btc.network, mnemonic, walletNumber, path)
}

const auth = (privateKey) => {
  if (privateKey) {
    const hash = bitcoin.crypto.sha256(privateKey)
    const d = BigInteger.fromBuffer(hash)

    const keyPair = bitcoin.ECPair.fromWIF(privateKey, btc.network)

    const account = bitcoin.ECPair.fromWIF(privateKey, btc.network) // eslint-disable-line
    const { address } = bitcoin.payments.p2pkh({ pubkey: account.publicKey, network: btc.network })
    const { publicKey } = account

    return {
      account,
      keyPair,
      address,
      privateKey,
      publicKey,
    }
  }
}

const getPrivateKeyByAddress = (address) => {
  const {
    user: {
      btcData: {
        address: oldAddress,
        privateKey,
      },
      btcMnemonicData: {
        address: mnemonicAddress,
        privateKey: mnemonicKey,
      },
    },
  } = getState()

  if (oldAddress === address) return privateKey
  if (mnemonicAddress === address) return mnemonicKey
}

const login = (privateKey, mnemonic, mnemonicKeys) => {
  let sweepToMnemonicReady = false

  if (privateKey
    && mnemonic
    && mnemonicKeys
    && mnemonicKeys.btc === privateKey
  ) sweepToMnemonicReady = true

  if (!privateKey && mnemonic) sweepToMnemonicReady = true

  if (privateKey) {
    const hash = bitcoin.crypto.sha256(privateKey)
    const d = BigInteger.fromBuffer(hash)

    // keyPair     = bitcoin.ECPair.fromWIF(privateKey, btc.network)
  }
  else {
    console.info('Created account Bitcoin ...')
    // keyPair     = bitcoin.ECPair.makeRandom({ network: btc.network })
    // privateKey  = keyPair.toWIF()
    // use random 12 words
    if (!mnemonic) mnemonic = bip39.generateMnemonic()
    const accData = getWalletByWords(mnemonic)
    console.log('Btc. Generated walled from random 12 words')
    console.log(accData)
    privateKey = accData.WIF
    localStorage.setItem(constants.privateKeyNames.btcMnemonic, privateKey)
  }

  localStorage.setItem(constants.privateKeyNames.btc, privateKey)

  const data = {
    ...auth(privateKey),
    isMnemonic: sweepToMnemonicReady,
  }

  window.getBtcAddress = () => data.address
  window.getBtcData = () => data

  console.info('Logged in with Bitcoin', data)
  reducers.user.setAuthData({ name: 'btcData', data })
  if (!sweepToMnemonicReady) {
    // Auth with our mnemonic account
    if (mnemonic === `-`) {
      console.error('Sweep. Cant auth. Need new mnemonic or enter own for re-login')
      return
    }

    if (!mnemonicKeys
      || !mnemonicKeys.btc
    ) {
      console.error('Sweep. Cant auth. Login key undefined')
      return
    }

    const mnemonicData = {
      ...auth(mnemonicKeys.btc),
      isMnemonic: true,
    }
    console.info('Logged in with Bitcoin Mnemonic', mnemonicData)
    reducers.user.addWallet({
      name: 'btcMnemonicData',
      data: {
        currency: 'BTC',
        fullName: 'Bitcoin (New)',
        balance: 0,
        isBalanceFetched: false,
        balanceError: null,
        infoAboutCurrency: null,
        ...mnemonicData,
      },
    })
    new Promise(async (resolve) => {
      const balanceData = await fetchBalanceStatus(mnemonicData.address)
      if (balanceData) {
        reducers.user.setAuthData({
          name: 'btcMnemonicData',
          data: {
            ...balanceData,
            isBalanceFetched: true,
          },
        })
      } else {
        reducers.user.setBalanceError({ name: 'btcMnemonicData' })
      }
      resolve(true)
    })
  }

  return privateKey
}


const getTxRouter = (txId) => `/btc/tx/${txId}`

const getTx = (txRaw) => {
  if (txRaw
    && txRaw.getId
    && txRaw.getId instanceof 'function'
  ) {
    return txRaw.getId()
  } else {
    return txRaw
  }
}


const getLinkToInfo = (tx) => {

  if (!tx) {
    return
  }

  return `${config.link.bitpay}/tx/${tx}`
}

const fetchBalanceStatus = (address) => apiLooper.get('bitpay', `/address/${address}/balance/`, {
  checkStatus: (answer) => {
    try {
      if (answer && answer.balance !== undefined) return true
    } catch (e) { /* */ }
    return false
  },
}).then(({ balance, unconfirmed }) => ({
  address,
  balance: new BigNumber(balance).dividedBy(1e8).toNumber(),
  unconfirmedBalance: new BigNumber(unconfirmed).dividedBy(1e8).toNumber(),
}))
  .catch((e) => false)
const getBalance = () => {
  const { user: { btcData: { address } } } = getState()

  return apiLooper.get('bitpay', `/address/${address}/balance/`, {
    inQuery: {
      delay: 500,
      name: `balance`,
    },
    checkStatus: (answer) => {
      try {
        if (answer && answer.balance !== undefined) return true
      } catch (e) { /* */ }
      return false
    },
  }).then(({ balance, unconfirmed }) => {
    balance = new BigNumber(balance).dividedBy(1e8).toNumber()
    console.log('BTC Balance: ', balance)
    console.log('BTC unconfirmedBalance Balance: ', unconfirmed)
    reducers.user.setBalance({
      name: 'btcData',
      amount: balance,
      unconfirmedBalance: new BigNumber(unconfirmed).dividedBy(1e8).toNumber(),
    })
    return balance
  })
    .catch((e) => {
      reducers.user.setBalanceError({ name: 'btcData' })
    })
}

const fetchBalance = (address) =>
  apiLooper.get('bitpay', `/address/${address}/balance/`, {
    checkStatus: (answer) => {
      try {
        if (answer && answer.balance !== undefined) return true
      } catch (e) { /* */ }
      return false
    },
    inQuery: {
      delay: 500,
      name: `balance`,
    },
  }).then(({ balance }) => new BigNumber(balance).dividedBy(1e8).toNumber())

const fetchTxRaw = (txId, cacheResponse) =>
  apiLooper.get('blockcypher', `/txs/${txId}?includeHex=true`, {
    cacheResponse,
    checkStatus: (answer) => {
      try {
        if (answer && answer.hex !== undefined) return true
      } catch (e) {}
      return false
    },
  }).then(({ hex }) => hex)

const fetchTx = (hash, cacheResponse) =>
  apiLooper.get('bitpay', `/tx/${hash}`, {
    cacheResponse,
    checkStatus: (answer) => {
      try {
        if (answer && answer.fee !== undefined) return true
      } catch (e) { /* */ }
      return false
    },
  }).then(({ fee, ...rest }) => ({
      fees: BigNumber(fee).dividedBy(1e8).toNumber(),
      ...rest,
    }
  ))

const fetchTxInfo = (hash, cacheResponse) => {
  return new Promise(async (callback, txinfoReject) => {
    let baseTxInfo = false
    let txCoins = false

    try {
      baseTxInfo = await fetchTx(hash, cacheResponse)
    } catch (error) {
      console.error('Fail fetch tx info', error)
      txinfoReject(error)
      return
    }
    try {
      txCoins = await apiLooper.get(`bitpay`, `/tx/${hash}/coins`, {
        cacheResponse,
        /* checkStatus */
      })
    } catch (error) {
      console.error('Failt fetch tx coin info', error)
      txinfoReject(error)
    }

    let receiverAddress = null
    let afterBalance = txCoins && txCoins.inputs && txCoins.inputs[1] 
      ? new BigNumber(txCoins.inputs[1].value).dividedBy(1e8).toNumber() 
      : null
    let adminOutput = []
    let adminFee = false
    let afterOutput = []

    if (!txCoins || !txCoins.inputs || !txCoins.outputs) {
      console.error('tx coin info empty')
      txinfoReject('tx coin info empty')
    }

    console.log('Debug fetchTxInfo', baseTxInfo, txCoins)

    const senderAddress = txCoins && txCoins.inputs ? txCoins.inputs[0].address : null
    const amount = new BigNumber(txCoins.outputs[0].value).dividedBy(1e8).toNumber()

    if (hasAdminFee) {
      adminOutput = txCoins.outputs.filter((out) => {
        return (
          out.address === hasAdminFee.address
          && !(new BigNumber(out.value).eq(amount))
        )
      })
    }


    /*
    // @ToDo - need fix
    if (txCoins && txCoins.outputs) {
      afterOutput = txCoins.outputs.filter(({ address }) => {
        return (
          address !== hasAdminFee.address
        )
      })
    }
    */

    if (afterOutput.length) {
      afterBalance = new BigNumber(afterOutput[0].value).dividedBy(1e8).toNumber()
    }

    if (adminOutput.length) {
      adminFee = new BigNumber(adminOutput[0].value).dividedBy(1e8).toNumber()
    }

    
    if (txCoins && txCoins.outputs && txCoins.outputs[0]) {
      receiverAddress = txCoins.outputs[0].address
    }
    
    const txInfo = {
      amount,
      afterBalance,
      senderAddress,
      confirmed: true, // !!(rest.confirmations), // @ToDo - need fix
      receiverAddress,
      
      minerFee: baseTxInfo.fees,
      adminFee,
      minerFeeCurrency: 'BTC',
      // @ ToDo - need fix
      outputs: [], /* vout.map((out) => {
        const voutAddrBuf = Buffer.from(out.scriptPubKey.hex, 'hex')
        const currentAddress = bitcoin.address.fromOutputScript(voutAddrBuf, btc.network)
        return {
          amount: new BigNumber(out.value).toNumber(),
          address: currentAddress,
        }
      }),*/
    }

    callback( txInfo )
  })
}

const getInvoices = (address) => {
  const { user: { btcData: { userAddress } } } = getState()

  address = address || userAddress

  return actions.invoices.getInvoices({
    currency: 'BTC',
    address,
  })
}

const getAllMyAddresses = () => {
  const {
    user: {
      btcData,
      btcMnemonicData,
      btcMultisigSMSData,
      btcMultisigUserData,
      btcMultisigG2FAData,
      btcMultisigPinData,
    },
  } = getState()

  const retData = []
  // Проверяем, был ли sweep
  if (btcMnemonicData
    && btcMnemonicData.address
    && btcData
    && btcData.address
    && btcMnemonicData.address !== btcData.address
  ) {
    retData.push(btcMnemonicData.address.toLowerCase())
  }

  retData.push(btcData.address.toLowerCase())

  if (btcMultisigSMSData && btcMultisigSMSData.address) retData.push(btcMultisigSMSData.address.toLowerCase())
  // @ToDo - SMS MultiWallet

  if (btcMultisigUserData && btcMultisigUserData.address) retData.push(btcMultisigUserData.address.toLowerCase())
  if (btcMultisigUserData && btcMultisigUserData.wallets && btcMultisigUserData.wallets.length) {
    btcMultisigUserData.wallets.map((wallet) => {
      retData.push(wallet.address.toLowerCase())
    })
  }

  if (btcMultisigPinData && btcMultisigPinData.address) retData.push(btcMultisigPinData.address.toLowerCase())

  return retData
}

const getDataByAddress = (address) => {
  const {
    user: {
      btcData,
      btcMnemonicData,
      btcMultisigSMSData,
      btcMultisigUserData,
      btcMultisigG2FAData,
    },
  } = getState()

  const founded = [
    btcData,
    btcMnemonicData,
    btcMultisigSMSData,
    btcMultisigUserData,
    ...(
      btcMultisigUserData
      && btcMultisigUserData.wallets
      && btcMultisigUserData.wallets.length
    )
      ? btcMultisigUserData.wallets
      : [],
    btcMultisigG2FAData,
  ].filter(data => data && data.address && data.address.toLowerCase() === address.toLowerCase())

  return (founded.length) ? founded[0] : false
}

const getTransactionBlockryper = (address, ownType) =>
  new Promise((resolve) => {
    const myAllWallets = getAllMyAddresses()

    let { user: { btcData: { address: userAddress } } } = getState()
    address = address || userAddress

    const type = (ownType) || 'btc'

    if (!typeforce.isCoinAddress.BTC(address)) {
      resolve([])
    }
    const calcSum = (accumulator, currentValue) => accumulator + currentValue

    const url = `/addrs/${address}/full`
    apiLooper
      .get('blockcypher', url)
      .then((answer) => {
        if (answer
          && answer.txs
        ) {
          const transactions = answer.txs.map((item) => {
            const direction = item.inputs[0].addresses && item.inputs[0].addresses[0] !== address 
              ? 'in' 
              : 'out'

            const isSelf = direction === 'out'
              && item.outputs.filter((output) => {
                  const voutAddrBuf = Buffer.from(output.script, 'hex')
                  const currentAddress = bitcoin.address.fromOutputScript(voutAddrBuf, btc.network)
                  return currentAddress === address
              }).length === item.outputs.length

            let value = isSelf
              ? item.fees
              : item.outputs.filter((output) => {
                const voutAddrBuf = Buffer.from(output.script, 'hex')
                const currentAddress = bitcoin.address.fromOutputScript(voutAddrBuf, btc.network)

                return direction === 'in'
                  ? (currentAddress === address)
                  : (currentAddress !== address)
              })[0].value

            return({
              type,
              hash: item.hash,
              canEdit: (myAllWallets.indexOf(address) !== -1),
              confirmations: item.confirmations,
              value: new BigNumber(value).dividedBy(1e8).toNumber(),
              date: (
                Math.floor(
                  new Date(
                    (item.confirmations)
                    ? item.confirmed
                    : item.received
                  )
                )
              ) * 1000,
              direction: isSelf ? 'self' : direction,
            })
          })

          resolve(transactions)
        } else {
          resolve([])
        }
      })
      .catch((e) => {
        console.error('Get btc txs Error', e)
        resolve([])
      })
  })

const getTransactionBitcore = (address, ownType) =>
  new Promise((resolve) => {
    const myAllWallets = getAllMyAddresses()

    let { user: { btcData: { address: userAddress } } } = getState()
    address = address || userAddress

    const type = (ownType) || 'btc'

    if (!typeforce.isCoinAddress.BTC(address)) {
      resolve([])
    }

    const url = `/address/${address}/txs`
    apiLooper
      .get('bitpay', url)
      .then((answer) => {
        if (answer && answer.length) {
          const transactions = answer.map((item) => {
            console.log('txItem', item)
            /*
            const direction = item.inputs[0].addresses && item.inputs[0].addresses[0] !== address 
              ? 'in' 
              : 'out'

            const isSelf = direction === 'out'
              && item.outputs.filter((output) => {
                  const voutAddrBuf = Buffer.from(output.script, 'hex')
                  const currentAddress = bitcoin.address.fromOutputScript(voutAddrBuf, btc.network)
                  return currentAddress === address
              }).length === item.outputs.length

            let value = isSelf
              ? item.fees
              : item.outputs.filter((output) => {
                const voutAddrBuf = Buffer.from(output.script, 'hex')
                const currentAddress = bitcoin.address.fromOutputScript(voutAddrBuf, btc.network)

                return direction === 'in'
                  ? (currentAddress === address)
                  : (currentAddress !== address)
              })[0].value

            return({
              type,
              hash: item.hash,
              canEdit: (myAllWallets.indexOf(address) !== -1),
              confirmations: item.confirmations,
              value: new BigNumber(value).dividedBy(1e8).toNumber(),
              date: (
                Math.floor(
                  new Date(
                    (item.confirmations)
                    ? item.confirmed
                    : item.received
                  )
                )
              ) * 1000,
              direction: isSelf ? 'self' : direction,
            })
            */
          })

          resolve(transactions)
        } else {
          resolve([])
        }
      })
      .catch((e) => {
        console.error('Get btc txs Error', e)
        resolve([])
      })
  })

const getTransaction = getTransactionBlockryper

const send = (data) => {
  return sendV5(data)
}

const addressIsCorrect = (address) => {
  try {
    let outputScript = bitcoin.address.toOutputScript(address, btc.network)
    if (outputScript) return true
  } catch (e) {}
  return false
}

// Deprecated
const sendWithAdminFee = async ({ from, to, amount, feeValue, speed } = {}) => {
  const {
    fee: adminFee,
    address: adminFeeAddress,
    min: adminFeeMinValue,
  } = config.opts.fee.btc
  const adminFeeMin = BigNumber(adminFeeMinValue)

  // fee - from amount - percent
  let feeFromAmount = BigNumber(adminFee).dividedBy(100).multipliedBy(amount)
  if (adminFeeMin.isGreaterThan(feeFromAmount)) feeFromAmount = adminFeeMin

  feeFromAmount = feeFromAmount.multipliedBy(1e8).integerValue() // Admin fee in satoshi


  feeValue = feeValue || await btc.estimateFeeValue({ inSatoshis: true, speed })

  const tx = new bitcoin.TransactionBuilder(btc.network)
  const unspents = await fetchUnspents(from)

  let fundValue = new BigNumber(String(amount)).multipliedBy(1e8).integerValue().toNumber()

  const totalUnspent = unspents.reduce((summ, { satoshis }) => summ + satoshis, 0)
  const skipValue = totalUnspent - fundValue - feeValue - feeFromAmount

  unspents.forEach(({ txid, vout }) => tx.addInput(txid, vout, 0xfffffffe))
  tx.addOutput(to, fundValue)

  if (skipValue > 546) {
    tx.addOutput(from, skipValue)
  }

  // admin fee output
  tx.addOutput(adminFeeAddress, feeFromAmount.toNumber())

  const txRaw = signAndBuild(tx, from)

  await broadcastTx(txRaw.toHex())

  return txRaw
}

const sendV5 = ({ from, to, amount, feeValue, speed, stateCallback } = {}) => {
  return new Promise(async (ready) => {
    const privateKey = getPrivateKeyByAddress(from)

    const keyPair = bitcoin.ECPair.fromWIF(privateKey, btc.network)

    // fee - from amount - percent

    let feeFromAmount = BigNumber(0)
    if (hasAdminFee) {
      const {
        fee: adminFee,
        min: adminFeeMinValue,
      } = config.opts.fee.btc
      const adminFeeMin = BigNumber(adminFeeMinValue)

      feeFromAmount = BigNumber(adminFee).dividedBy(100).multipliedBy(amount)
      if (adminFeeMin.isGreaterThan(feeFromAmount)) feeFromAmount = adminFeeMin

      feeFromAmount = feeFromAmount.multipliedBy(1e8).integerValue().toNumber() // Admin fee in satoshi
    }

    feeValue = feeValue || await btc.estimateFeeValue({ inSatoshis: true, speed })

    const unspents = await fetchUnspents(from)
    const fundValue = new BigNumber(String(amount)).multipliedBy(1e8).integerValue().toNumber()
    const totalUnspent = unspents.reduce((summ, { satoshis }) => summ + satoshis, 0)
    const skipValue = totalUnspent - fundValue - feeValue - feeFromAmount

    const psbt = new bitcoin.Psbt({network: btc.network})

    psbt.addOutput({
      address: to,
      value: fundValue,
    })

    if (skipValue > 546) {
      psbt.addOutput({
        address: from,
        value: skipValue
      })
    }

    if (hasAdminFee) {
      psbt.addOutput({
        address: hasAdminFee.address,
        value: feeFromAmount,
      })
    }

    for (let i = 0; i < unspents.length; i++) {
      const { txid, vout } = unspents[i]
      let rawTx = false
      rawTx = await fetchTxRaw(txid)

      psbt.addInput({
        hash: txid,
        index: vout,
        nonWitnessUtxo: Buffer.from(rawTx, 'hex'),
      })
    }

    psbt.signAllInputs(keyPair)
    psbt.finalizeAllInputs()

    const rawTx = psbt.extractTransaction().toHex();

    const broadcastAnswer = await broadcastTx(rawTx)

    const { txid } = broadcastAnswer
    ready(txid)
  })
}

// Deprecated
const sendDefault = async ({ from, to, amount, feeValue, speed } = {}) => {
  feeValue = feeValue || await btc.estimateFeeValue({ inSatoshis: true, speed })

  const tx = new bitcoin.TransactionBuilder(btc.network)
  const unspents = await fetchUnspents(from)

  const fundValue = new BigNumber(String(amount)).multipliedBy(1e8).integerValue().toNumber()
  const totalUnspent = unspents.reduce((summ, { satoshis }) => summ + satoshis, 0)
  const skipValue = totalUnspent - fundValue - feeValue

  unspents.forEach(({ txid, vout }) => tx.addInput(txid, vout, 0xfffffffe))
  tx.addOutput(to, fundValue)

  if (skipValue > 546) {
    tx.addOutput(from, skipValue)
  }


  const txRaw = signAndBuild(tx, from)

  await broadcastTx(txRaw.toHex())

  return txRaw
}

const signAndBuild = (transactionBuilder, address) => {
  let { user: { btcData: { privateKey } } } = getState()

  if (address) {
    // multi wallet - sweep upgrade
    privateKey = getPrivateKeyByAddress(address)
  } else {
    // single wallet - use btcData
  }

  const keyPair = bitcoin.ECPair.fromWIF(privateKey, btc.network)

  transactionBuilder.__INPUTS.forEach((input, index) => {
    transactionBuilder.sign(index, keyPair)
  })
  return transactionBuilder.buildIncomplete()
}

const fetchUnspents = (address) => {
  return new Promise((resolve, reject) => {
    apiLooper.get(
      'bitpay',
      `/address/${address}?unspent=true`,
      {
        cacheResponse: 5000,
      }
    ).then((answer) => {
      resolve(answer.map((txInfo, index) => {
        return {
          address,
          amount: BigNumber(txInfo.value).dividedBy(1e8).toNumber(),
          confirmations: txInfo.confirmations,
          height: txInfo.mintHeight,
          satoshis: txInfo.value,
          scriptPubKey: txInfo.script,
          txid: txInfo.mintTxid,
          vout: txInfo.mintIndex,
        }
      }))
    }).catch((error) => {
      console.error('btc fetchUnspents error', error)
    })
  })
}

const broadcastTx = (txRaw) => {
  return new Promise(async (resolve, reject) => {
    let answer = false
    try {
      answer = await apiLooper.post('bitpay', `/tx/send`, {
        body: {
          rawTx: txRaw,
        },
      })
    } catch (e) {}
    if (!answer || !answer.txid) {
      // use blockcryper
      const bcAnswer = await apiLooper.post('blockcypher', `/txs/push`, {
        body: {
          tx: txRaw,
        },
      })
      if (bcAnswer
        && bcAnswer.tx
        && bcAnswer.tx.hash) {
        resolve({
          txid: bcAnswer.tx.hash,
        })
      } else {
        reject()
      }
    } else {
      resolve(answer)
    }
  })
}

const signMessage = (message, encodedPrivateKey) => {
  const keyPair = bitcoin.ECPair.fromWIF(encodedPrivateKey, [bitcoin.networks.bitcoin, bitcoin.networks.testnet])
  const privateKeyBuff = Buffer.from(keyPair.privateKey)

  const signature = bitcoinMessage.sign(message, privateKeyBuff, keyPair.compressed)

  return signature.toString('base64')
}

const getReputation = () => Promise.resolve(0)

window.getMainPublicKey = getMainPublicKey

/*
  Проверяет списание со скрипта - последняя транзакция выхода
  Возвращает txId, адресс и сумму
*/
const checkWithdraw = (scriptAddress) => {
  const url = `/txs/?address=${scriptAddress}`

  return apiLooper.get('bitpay', url, {
    checkStatus: (answer) => {
      try {
        if (answer && answer.txs !== undefined) return true
      } catch (e) { /* */ }
      return false
    },
  }).then((res) => {
    if (res.txs.length > 1
      && res.txs[0].vout.length
    ) {
      const address = res.txs[0].vout[0].scriptPubKey.addresses[0]
      const {
        txid,
        valueOut: amount,
      } = res.txs[0]
      return {
        address,
        txid,
        amount,
      }
    }
    return false
  })
}


export default {
  login,
  checkWithdraw,
  getBalance,
  getTransaction,
  send,
  fetchUnspents,
  broadcastTx,
  fetchTx,
  fetchTxInfo,
  fetchBalance,
  signMessage,
  getReputation,
  getTx,
  getLinkToInfo,
  getInvoices,
  getWalletByWords,
  getRandomMnemonicWords,
  validateMnemonicWords,
  sweepToMnemonic,
  isSweeped,
  getSweepAddress,
  getAllMyAddresses,
  getDataByAddress,
  getMainPublicKey,
  getTxRouter,
  fetchTxRaw,
  addressIsCorrect,
  convertMnemonicToValid,
}
