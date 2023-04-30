import type { AWS } from '@serverless/typescript';
import config from './src/config';
import functions from '@functions/index';

const serverlessConfiguration: AWS = {
  service: 'suerveyws-api',
  frameworkVersion: '3',
  custom: {
    esbuild: {
      bundle: true,
      minify: !config.dev,
      sourcemap: true,
      exclude: [],
      target: 'node16',
      define: { 'require.resolve': undefined },
      platform: 'node',
    },
    serverlessOffline: {
      httpsProtocol: 'cert',
    },
    customCertificate: {
      certificateName: config.BASE_URL.replace("https://",""),
      hostedZoneIds: [
        '${ssm:/${self:provider.stage}/common/route53/hosted-id}',
      ],
      rewriteRecords: false,
    },
  },
  plugins: [
    'serverless-esbuild',
    'serverless-offline',
    'serverless-certificate-creator'
  ],
  provider: {
    name: 'aws',
    runtime: 'nodejs16.x',
    stage: '${opt:stage, "dev"}',
    stackName: '${self:provider.stage}-${self:service}',
    timeout: 30,
    apiGateway: {
      minimumCompressionSize: 1024,
      shouldStartNameWithService: true,
    },
    vpc: {
      securityGroupIds: [
        '${ssm:/${self:provider.stage}/common/vpc/securityGroupIds}',
      ],
      subnetIds: {
        'Fn::Split': [
          ',',
          '${ssm:/${self:provider.stage}/common/vpc/subnetIds}',
        ],
      },
    },
    deploymentBucket: {
      name: '${ssm:/${self:provider.stage}/common/serverless/bucketName}',
      serverSideEncryption: 'AES256',
    },
    environment: {
      REGION: config.REGION || '${opt:region, "eu-west-1"}',
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      NODE_OPTIONS: '--enable-source-maps --stack-trace-limit=1000',
      BASE_URL: config.BASE_URL,
      LINKEDIN_CLIENT_ID: '${ssm:/${self:provider.stage}/common/credential/oauth/linkedin/clientid}',
      LINKEDIN_CLIENT_SECRET:'${ssm:/${self:provider.stage}/common/credential/oauth/linkedin/clientsecret}',
     
    },
    iam: {
      role: {
        statements: [
          {
            Effect: 'Allow',
            Action: [
              'ssm:GetParameter',
              'ssm:GetParameters',
              'ssm:GetParametersByPath',
              'iam:CreateRole',
              'iam:CreatePolicy',
              'iam:PutRolePolicy',
            ],
            Resource: [
              'arn:aws:ssm:${opt:region, "eu-west-1"}:${aws:accountId}:parameter/${self:provider.stage}/lambda/${self:service}/*',
            ],
          },
          {
            Effect: 'Allow',
            Action: [
              's3:PutObject',
              's3:PutObjectAcl',
              's3:GetObject',
              's3:GetObjectAcl'
            ],
            Resource: [
              {
                'Fn::Join': ['', ['arn:aws:s3:::', { Ref: 'UIBucket' }]],
              },
              {
                'Fn::Join': [
                  '',
                  ['arn:aws:s3:::', { Ref: 'UIBucket' }, '/*'],
                ],
              }
            ]
          }
        ],
      },
    },
  },
  functions,
  resources: {
    Resources: {
      CloudFrontOriginAccessIdentityConfig: {
        Type: 'AWS::CloudFront::CloudFrontOriginAccessIdentity',
        Properties: {
          CloudFrontOriginAccessIdentityConfig: {
            Comment: `Cloudfront OAI for ${config.BASE_URL.replace(
              'https://',
              ''
            )}`,
          },
        },
      },
      AuthApiCloudFront: {
        Type: 'AWS::CloudFront::Distribution',
        Properties: {
          DistributionConfig: {
            Comment: 'CloudFront Distribution for the Auth Api',
            DefaultRootObject: 'index.html',
            HttpVersion: 'http2',
            DefaultCacheBehavior: {
              TargetOriginId: `${config.BASE_URL.replace('https://', '')}.s3`,
              ViewerProtocolPolicy: 'allow-all',
              DefaultTTL: 0,
              MinTTL: 0,
              MaxTTL: 0,
              ForwardedValues: {
                QueryString: true,
                Headers: [
                  'Authorization',
                  'Access-Control-Allow-Origin',
                  'Access-Control-Allow-Methods',
                  'Access-Control-Allow-Headers',
                  'Access-Control-Max-Age',
                ],
              },
              AllowedMethods: ['GET', 'OPTIONS', 'HEAD'],
            },
            Aliases: [config.BASE_URL.replace('https://', '')],
            ViewerCertificate: {
              AcmCertificateArn:
                '${certificate(${self:custom.customCertificate.certificateName}):CertificateArn}',
              SslSupportMethod: 'sni-only',
              MinimumProtocolVersion: 'TLSv1.2_2021',
            },
            Enabled: true,
            Origins: [
              {
                Id: `${config.BASE_URL.replace('https://', '')}.api.gateway`,
                DomainName: {
                  'Fn::Join': [
                    '.',
                    [
                      { Ref: 'ApiGatewayRestApi' },
                      'execute-api.${opt:region, "eu-west-1"}.amazonaws.com',
                    ],
                  ],
                },
                OriginPath: '/${self:provider.stage}',
                CustomOriginConfig: {
                  OriginProtocolPolicy: 'https-only',
                },
              },
              {
                Id: `${config.BASE_URL.replace('https://', '')}.s3`,
                DomainName:
                  config.BASE_URL.replace('https://', '') +
                  '.s3.${opt:region, "eu-west-1"}.amazonaws.com',
                S3OriginConfig: {
                  OriginAccessIdentity: {
                    'Fn::Sub':
                      'origin-access-identity/cloudfront/${CloudFrontOriginAccessIdentityConfig}',
                  },
                },
              },
            ],
            CacheBehaviors: [
              {
                TargetOriginId: `${config.BASE_URL.replace(
                  'https://',
                  ''
                )}.api.gateway`,
                ViewerProtocolPolicy: 'redirect-to-https',
                PathPattern: '/api/*',
                DefaultTTL: 0,
                MinTTL: 0,
                MaxTTL: 0,
                ForwardedValues: {
                  QueryString: true,
                  Headers: [
                    'Authorization',
                    'Access-Control-Allow-Origin',
                    'Access-Control-Allow-Methods',
                    'Access-Control-Allow-Headers',
                    'Access-Control-Max-Age',
                  ],
                },
                AllowedMethods: [
                  'GET',
                  'OPTIONS',
                  'HEAD',
                  'POST',
                  'PUT',
                  'PATCH',
                  'DELETE',
                ],
              }
            ],
            CustomErrorResponses: [
              {
                ErrorCachingMinTTL: 10,
                ErrorCode: 400,
                ResponseCode: 200,
                ResponsePagePath: '/index.html',
              },
              {
                ErrorCachingMinTTL: 10,
                ErrorCode: 404,
                ResponseCode: 200,
                ResponsePagePath: '/index.html',
              },
            ],
          },
        },
      },
      GatewayResponseDefault4XX: {
        Type: 'AWS::ApiGateway::GatewayResponse',
        Properties: {
          ResponseParameters: {
            'gatewayresponse.header.Access-Control-Allow-Origin': "'*'",
            'gatewayresponse.header.Access-Control-Allow-Headers': "'*'",
          },
          ResponseType: 'DEFAULT_4XX',
          RestApiId: {
            Ref: 'ApiGatewayRestApi',
          },
        },
      },
      UIBucket: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          AccessControl: 'Private',
          BucketName: `${config.BASE_URL.replace('https://', '')}`,
          VersioningConfiguration: {
            Status: 'Suspended',
          },
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
        },
      },
      UIBucketPolicy: {
        Type: 'AWS::S3::BucketPolicy',
        Properties: {
          Bucket: {
            Ref: 'UIBucket',
          },
          PolicyDocument: {
            Version: '2008-10-17',
            Id: 'cloudfront-read-access',
            Statement: [
              {
                Sid: 'AllowListAccessToCloudfront',
                Effect: 'Allow',
                Principal: {
                  AWS: {
                    'Fn::Sub':
                      'arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity ${CloudFrontOriginAccessIdentityConfig}',
                  },
                },
                Action: ['s3:GetBucketLocation', 's3:ListBucket'],
                Resource: [
                  {
                    'Fn::Join': ['', ['arn:aws:s3:::', { Ref: 'UIBucket' }]],
                  },
                ],
              },
              {
                Sid: 'AllowReadAccessToCloudfront',
                Effect: 'Allow',
                Principal: {
                  AWS: {
                    'Fn::Sub':
                      'arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity ${CloudFrontOriginAccessIdentityConfig}',
                  },
                },
                Action: ['s3:GetObject'],
                Resource: [
                  {
                    'Fn::Join': [
                      '',
                      ['arn:aws:s3:::', { Ref: 'UIBucket' }, '/*'],
                    ],
                  },
                ],
              },
              {
                Sid: 'AllowListAccessToJenkinsAgent',
                Effect: 'Allow',
                Principal: {
                  AWS: 'arn:aws:iam::707778264680:role/jenkins-agent-wfus',
                },
                Action: ['s3:GetBucketLocation', 's3:ListBucket'],
                Resource: [
                  {
                    'Fn::Join': ['', ['arn:aws:s3:::', { Ref: 'UIBucket' }]],
                  },
                ],
              },
              {
                Sid: 'AllowWriteAccessToJenkinsAgent',
                Effect: 'Allow',
                Principal: {
                  AWS: 'arn:aws:iam::707778264680:role/jenkins-agent-wfus',
                },
                Action: [
                  's3:GetObject',
                  's3:PutObject',
                  's3:PutObjectAcl',
                  's3:DeleteObject',
                ],
                Resource: [
                  {
                    'Fn::Join': [
                      '',
                      ['arn:aws:s3:::', { Ref: 'UIBucket' }, '/*'],
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    },
  },
};

module.exports = serverlessConfiguration;
