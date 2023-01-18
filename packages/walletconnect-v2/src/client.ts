import {
  Algo,
  AminoSignResponse,
  OfflineAminoSigner,
  StdSignDoc,
} from '@cosmjs/amino';
import { DirectSignResponse, OfflineDirectSigner } from '@cosmjs/proto-signing';
import {
  DirectSignDoc,
  SignOptions,
  Wallet,
  WalletClient,
} from '@cosmos-kit/core';
import SignClient from '@walletconnect/sign-client';
import { SessionTypes, SignClientTypes } from '@walletconnect/types';
import { CoreUtil } from './utils';

const EXPLORER_API = 'https://explorer-api.walletconnect.com';

export class WCClientV2 implements WalletClient {
  readonly walletInfo: Wallet;
  readonly projectId: string; // wallet connect dapp project id
  signClient?: SignClient;
  qrUrl?: string;
  appUrl?: string;
  wcWalletInfo?: any;

  constructor(walletInfo: Wallet, projectId: string) {
    this.walletInfo = walletInfo;
    this.projectId = projectId;
  }

  get walletName() {
    return this.walletInfo.name;
  }

  get session(): SessionTypes.Struct {
    if (!this.signClient) {
      throw new Error('Sign client not initialized.');
    }
    const ss = this.signClient.session;
    if (ss.length) {
      const lastKeyIndex = ss.keys.length - 1;
      const session = ss.get(ss.keys[lastKeyIndex]);
      return session;
    }
    throw new Error('Session is not proposed yet.');
  }

  async initWCWalletInfo() {
    const fetcUrl = `${EXPLORER_API}/v3/wallets?projectId=${this.projectId}&sdks=sign_v2&search=${this.walletName}`;
    const fetched = await fetch(fetcUrl);
    this.wcWalletInfo = await fetched.json();
  }

  async initSignClient(options: SignClientTypes.Options) {
    this.signClient = await SignClient.init(options);
  }

  async connect(chainId: string, isMobile: boolean) {
    if (!this.signClient) {
      throw new Error('Sign client not initialized.');
    }

    const namespaces = {
      cosmos: {
        methods: [
          'cosmos_getAccounts',
          'cosmos_signAmino',
          'cosmos_signDirect',
        ],
        chains: [`cosmos:${chainId}`],
        events: [],
      },
    };
    const { uri, approval } = await this.signClient.connect({
      requiredNamespaces: namespaces,
    });
    this.qrUrl = uri;
    this.appUrl = await this.getAppUrl();
    if (isMobile && this.appUrl) {
      CoreUtil.openHref(this.appUrl);
    }
    await approval();
  }

  async getAppUrl(): Promise<string | undefined> {
    if (!this.qrUrl) {
      throw new Error('Sign client not connected.');
    }

    if (!this.wcWalletInfo) {
      throw new Error(
        'wcWalletInfo is not initialized. Try call initWCWalletInfo.'
      );
    }

    const { native, universal } = this.wcWalletInfo.listings[
      this.walletInfo.wcProjectId!
    ].mobile as { native: string | null; universal: string | null };

    let href: string | undefined;
    if (universal) {
      href = CoreUtil.formatUniversalUrl(
        universal,
        this.qrUrl,
        this.walletName
      );
    } else if (native) {
      href = CoreUtil.formatNativeUrl(native, this.qrUrl, this.walletName);
    }
    return href;
  }

  async disconnect() {
    if (!this.signClient) {
      throw new Error('Sign client not initialized.');
    }
    await this.signClient.disconnect({
      topic: this.session.topic,
      reason: {
        code: 201,
        message: 'disconnect wallet',
      },
    });
  }

  async getAccount(chainId: string) {
    // if (!this.signClient) {
    //   throw new Error('Sign client not initialized.');
    // }
    // const resp = await this.signClient.request({
    //   topic: this.session.topic,
    //   chainId: `cosmos:${chainId}`,
    //   request: {
    //     method: 'cosmos_getAccounts',
    //     params: {},
    //   },
    // });
    // const result = (resp as any)['result'][0] as WCAccount;

    // return {
    //   address: result.address,
    //   algo: result.algo,
    //   pubkey: Buffer.from(result.pubkey, 'hex'),
    //   isNanoLedger: result.isNanoLedger,
    // };

    const { namespaces, self } = this.session;

    return {
      address: namespaces.cosmos.accounts[0].split(':')[2],
      algo: 'secp256k1' as Algo,
      pubkey: Buffer.from(self.publicKey, 'hex'),
      isNanoLedger: false,
    };
  }

  getOfflineSignerAmino(chainId: string) {
    return {
      getAccounts: async () => {
        return [await this.getAccount(chainId)];
      },
      signAmino: (signerAddress: string, signDoc: StdSignDoc) =>
        this.signAmino(chainId, signerAddress, signDoc),
    } as OfflineAminoSigner;
  }

  getOfflineSignerDirect(chainId: string) {
    return {
      getAccounts: async () => {
        return [await this.getAccount(chainId)];
      },
      signDirect: (signerAddress: string, signDoc: DirectSignDoc) =>
        this.signDirect(chainId, signerAddress, signDoc),
    } as OfflineDirectSigner;
  }

  async getOfflineSigner(chainId: string) {
    const key = await this.getAccount(chainId);
    if (key.isNanoLedger || typeof key.isNanoLedger === 'undefined') {
      return this.getOfflineSignerAmino(chainId);
    }
    return this.getOfflineSignerDirect(chainId);
  }

  async signAmino(
    chainId: string,
    signer: string,
    signDoc: StdSignDoc,
    signOptions?: SignOptions
  ): Promise<AminoSignResponse> {
    if (!this.signClient) {
      throw new Error('Sign client not initialized.');
    }
    return (
      (await this.signClient.request({
        topic: this.session.topic,
        chainId: `cosmos:${chainId}`,
        request: {
          method: 'cosmos_signAmino',
          params: {
            signerAddress: signer,
            signDoc,
          },
        },
      })) as any
    )['result'] as AminoSignResponse;
  }

  async signDirect(
    chainId: string,
    signer: string,
    signDoc: DirectSignDoc,
    signOptions?: SignOptions
  ): Promise<DirectSignResponse> {
    if (!this.signClient) {
      throw new Error('Sign client not initialized.');
    }
    return (
      (await this.signClient.request({
        topic: this.session.topic,
        chainId: `cosmos:${chainId}`,
        request: {
          method: 'cosmos_signDirect',
          params: {
            signerAddress: signer,
            signDoc,
          },
        },
      })) as any
    )['result'] as DirectSignResponse;
  }
}
