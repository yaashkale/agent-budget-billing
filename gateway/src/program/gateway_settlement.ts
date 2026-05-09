/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/gateway_settlement.json`.
 */
export type GatewaySettlement = {
  "address": "92xJg6zJM8Rh8bPDnpuX1PxSnVJ1dojodsE1dSJqNAHh",
  "metadata": {
    "name": "gatewaySettlement",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "commitWindow",
      "discriminator": [
        212,
        136,
        159,
        180,
        113,
        80,
        194,
        103
      ],
      "accounts": [
        {
          "name": "publisher",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  98,
                  108,
                  105,
                  115,
                  104,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "publisher.publisher_id",
                "account": "publisher"
              }
            ]
          }
        },
        {
          "name": "window",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  110,
                  100,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "publisher"
              },
              {
                "kind": "arg",
                "path": "windowIndex"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "windowIndex",
          "type": "u64"
        },
        {
          "name": "merkleRoot",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "prevWindowHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "totalCalls",
          "type": "u64"
        },
        {
          "name": "totalRevenueUsdc",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initPublisher",
      "discriminator": [
        101,
        102,
        35,
        176,
        210,
        160,
        28,
        154
      ],
      "accounts": [
        {
          "name": "publisher",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  98,
                  108,
                  105,
                  115,
                  104,
                  101,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "publisherId"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "publisherId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "publisher",
      "discriminator": [
        86,
        152,
        93,
        215,
        234,
        89,
        232,
        104
      ]
    },
    {
      "name": "window",
      "discriminator": [
        66,
        77,
        66,
        242,
        153,
        13,
        1,
        69
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Signer is not the publisher authority"
    },
    {
      "code": 6001,
      "name": "windowIndexMismatch",
      "msg": "Window index does not match the publisher's current window index"
    },
    {
      "code": 6002,
      "name": "windowOverflow",
      "msg": "Window index overflow"
    }
  ],
  "types": [
    {
      "name": "publisher",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "publisherId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "currentWindowIndex",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "window",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "windowIndex",
            "type": "u64"
          },
          {
            "name": "merkleRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "prevWindowHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "totalCalls",
            "type": "u64"
          },
          {
            "name": "totalRevenueUsdc",
            "type": "u64"
          },
          {
            "name": "committedAt",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
