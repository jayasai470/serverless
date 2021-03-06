'use strict';

const BbPromise = require('bluebird');
const validate = require('./lib/validate');
const setBucketName = require('./lib/setBucketName');
const updateStack = require('./lib/updateStack');
const monitorStack = require('./lib/monitorStack');
const findAndGroupDeployments = require('./utils/findAndGroupDeployments');

class AwsRollback {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');

    Object.assign(this, validate, setBucketName, updateStack, monitorStack);

    this.hooks = {
      'before:rollback:initialize': async () => BbPromise.bind(this).then(this.validate),
      'rollback:rollback': async () => {
        if (!this.options.timestamp) {
          const command = this.serverless.pluginManager.spawn('deploy:list');
          this.serverless.cli.log(
            [
              'Use a timestamp from the deploy list below to rollback to a specific version.',
              'Run `sls rollback -t YourTimeStampHere`',
            ].join('\n')
          );
          return command;
        }

        return BbPromise.bind(this)
          .then(this.setBucketName)
          .then(this.setStackToUpdate)
          .then(this.updateStack);
      },
    };
  }

  async setStackToUpdate() {
    const service = this.serverless.service;
    const serviceName = this.serverless.service.service;
    const stage = this.provider.getStage();
    const deploymentPrefix = this.provider.getDeploymentPrefix();
    const prefix = `${deploymentPrefix}/${serviceName}/${stage}`;

    return this.provider
      .request('S3', 'listObjectsV2', {
        Bucket: this.bucketName,
        Prefix: prefix,
      })
      .then((response) => {
        const deployments = findAndGroupDeployments(response, deploymentPrefix, serviceName, stage);

        if (deployments.length === 0) {
          const msg = "Couldn't find any existing deployments.";
          const hint = 'Please verify that stage and region are correct.';
          return BbPromise.reject(`${msg} ${hint}`);
        }

        let date = new Date(this.options.timestamp);

        // The if below is added due issues#5664 - Check it for more details
        if (date instanceof Date === false || isNaN(date.valueOf())) {
          date = new Date(Number(this.options.timestamp));
        }

        const dateString = `${date.getTime().toString()}-${date.toISOString()}`;
        const exists = deployments.some((deployment) =>
          deployment.some(
            (item) =>
              item.directory === dateString &&
              item.file === this.provider.naming.getCompiledTemplateS3Suffix()
          )
        );

        if (!exists) {
          const msg = `Couldn't find a deployment for the timestamp: ${this.options.timestamp}.`;
          const hint = 'Please verify that the timestamp, stage and region are correct.';
          return BbPromise.reject(`${msg} ${hint}`);
        }

        service.package.artifactDirectoryName = `${prefix}/${dateString}`;
        return BbPromise.resolve();
      });
  }
}

module.exports = AwsRollback;
