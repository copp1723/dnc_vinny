# DNC_VINNY Integration Guide

## 🚀 Complete DNC Compliance System - Ready for Production

This guide provides step-by-step instructions for integrating and deploying the DNC compliance automation system.

## 📋 System Overview

The DNC_VINNY system automates the entire DNC (Do Not Call) compliance workflow:

```
VinSolutions CRM → Extract Customers → PossibleNOW API → DNC Check → Mark in CRM → Compliance Report
```

## 🏗️ Architecture Components

### 1. **API Clients** (`src/api-clients/`)
- **PossibleNOW API Client** - OAuth 2.0 authentication, batch processing, rate limiting
  - ✅ Submit DNC checks (up to 500 records per batch)
  - ✅ Retrieve results with polling
  - ✅ Circuit breaker pattern for resilience
  - ✅ Comprehensive error handling

### 2. **Adapters** (`src/adapters/`)
- **VinSolutions Customer Extractor** - Modified from existing VinSolutionsExtractor
  - ✅ Navigate to customer reports
  - ✅ Extract customer data (last 30 days)
  - ✅ Stream processing for 50,000+ records
  - ✅ Phone number normalization

### 3. **Workflows** (`src/workflows/`)
- **DNC Compliance Workflow** - End-to-end orchestration
  - ✅ Login with 2FA support
  - ✅ Extract → Check → Mark → Report
  - ✅ Checkpoint/resume capability
  - ✅ Progress tracking with ETA
  - ✅ Monthly scheduling

### 4. **Modules** (`src/modules/`)
- **Customer Search** - Find and update specific customers
  - ✅ Search by phone/name/email
  - ✅ Navigate to customer profiles
  - ✅ Update DNC status
  - ✅ Batch processing support

### 5. **Configuration** (`src/config/`)
- **Unified Configuration System**
  - ✅ Multi-dealership support
  - ✅ Encrypted credential storage
  - ✅ Environment and file-based config
  - ✅ Health checks and validation

### 6. **Multi-Store** (`src/multi-store/`)
- **Multi-Store Orchestration**
  - ✅ Parallel dealership processing
  - ✅ Resource pool management
  - ✅ Priority-based queuing
  - ✅ Failure isolation

### 7. **Monitoring** (`src/monitoring/`)
- **Compliance Monitoring & Reporting**
  - ✅ Real-time metrics collection
  - ✅ Compliance tracking
  - ✅ Alert management
  - ✅ Comprehensive reporting (PDF/Excel)
  - ✅ WebSocket dashboard API

## 🔧 Installation & Setup

### 1. Clone and Install

```bash
git clone https://github.com/copp1723/dnc_vinny.git
cd dnc_vinny
npm install
```

### 2. Configure Environment

```bash
# Create configuration directory
mkdir config

# Initialize configuration
npm run dnc:config:init

# Set up master password for encryption
export DNC_MASTER_PASSWORD="your-secure-password"
```

### 3. Configure Dealerships

```bash
# Add a dealership
npm run multi-store:add -- --id "dealer1" --name "ABC Motors" --priority high

# Configure VinSolutions credentials
npm run dnc:config:set -- --dealership dealer1 --key vinsolutions.username --value "username"
npm run dnc:config:set -- --dealership dealer1 --key vinsolutions.password --value "password" --encrypt
```

### 4. Configure PossibleNOW API

```bash
# Set API credentials
npm run dnc:config:set -- --key possiblenow.clientId --value "your-client-id"
npm run dnc:config:set -- --key possiblenow.clientSecret --value "your-secret" --encrypt
npm run dnc:config:set -- --key possiblenow.environment --value "production"
```

## 🏃 Running the System

### Manual Run

```bash
# Run for all configured dealerships
npm run dnc:run

# Run for specific dealership
npm run dnc:run -- --dealership dealer1

# Resume from checkpoint
npm run dnc:resume -- --dealership dealer1
```

### Scheduled Run

```bash
# Enable monthly schedule (runs on 1st of each month at 2 AM)
npm run dnc:schedule -- --enable --cron "0 2 1 * *"

# View schedule status
npm run dnc:schedule -- --status
```

### Multi-Store Processing

```bash
# Process all stores
npm run multi-store:run

# View multi-store status
npm run multi-store:status
```

## 📊 Monitoring & Reports

### Start Monitoring Services

```bash
# Start monitoring API (port 3003)
npm run monitoring:start

# Start WebSocket dashboard (port 3004)
npm run monitoring:dashboard
```

### Access Dashboards

- **REST API**: http://localhost:3003/api/monitoring/
  - `/metrics` - System metrics
  - `/compliance` - Compliance statistics
  - `/reports` - Generate reports

- **WebSocket Dashboard**: ws://localhost:3004
  - Real-time metrics updates
  - Live workflow progress
  - Alert notifications

### Generate Reports

```bash
# Generate compliance report
npm run dnc:report -- --type compliance --format pdf --dealership dealer1

# Generate monthly summary
npm run dnc:report -- --type monthly --format excel --all-dealerships
```

## 🔒 Security Considerations

1. **Credential Storage**
   - All credentials are encrypted using AES-256-GCM
   - Master password required for decryption
   - Never store master password in code

2. **API Keys**
   - Store in environment variables or encrypted config
   - Use `.env` files for development only
   - Rotate keys regularly

3. **Audit Trail**
   - All DNC updates are logged with timestamps
   - User attribution for all actions
   - 1-year retention for compliance

## 🐛 Troubleshooting

### Common Issues

1. **2FA Code Not Received**
   - Check webhook server is running: `npm run webhook:start`
   - Verify webhook URL is accessible
   - Check email configuration

2. **Browser Crashes**
   - Increase memory limits: `export NODE_OPTIONS="--max-old-space-size=4096"`
   - Reduce batch size in config
   - Enable headless mode

3. **API Rate Limits**
   - Check current limits: `npm run dnc:status -- --api-limits`
   - Adjust batch sizes and delays
   - Enable rate limit monitoring

### Debug Mode

```bash
# Enable debug logging
export DEBUG=dnc:*

# Run with screenshots
npm run dnc:run -- --screenshots --debug

# Check logs
tail -f logs/dnc-workflow.log
```

## 🚦 Production Deployment

### 1. System Requirements

- Node.js 18+ 
- 8GB RAM minimum (16GB recommended)
- 50GB disk space for logs and reports
- Stable internet connection

### 2. Process Management

```bash
# Use PM2 for production
npm install -g pm2

# Start all services
pm2 start ecosystem.config.js

# Monitor
pm2 monit
```

### 3. Backup & Recovery

```bash
# Backup configuration
npm run dnc:config:export -- --file config-backup.json

# Backup checkpoints
npm run dnc:checkpoint:backup

# Restore from backup
npm run dnc:config:import -- --file config-backup.json
```

## 📈 Performance Optimization

1. **Batch Sizes**
   - Adjust based on system resources
   - Start with 100 records per batch
   - Monitor memory usage

2. **Parallel Processing**
   - Configure max concurrent stores
   - Balance with API rate limits
   - Monitor browser pool health

3. **Caching**
   - Enable customer data caching
   - Set appropriate TTL values
   - Monitor cache hit rates

## 🎯 Next Steps

1. **Testing**
   - Run in sandbox mode first
   - Verify DNC marking accuracy
   - Test failure scenarios

2. **Monitoring**
   - Set up alerts for failures
   - Monitor compliance rates
   - Track processing times

3. **Optimization**
   - Tune batch sizes
   - Optimize scheduling
   - Implement caching strategies

## 📞 Support

For issues or questions:
- Check logs in `logs/` directory
- Review error screenshots in `screenshots/`
- Consult API documentation
- Contact: Josh Copp

---

**Version**: 1.0.0  
**Last Updated**: January 2025  
**Status**: Production Ready ✅