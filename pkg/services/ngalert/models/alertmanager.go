package models

import "time"

// AlertConfiguration represents a single version of the Alerting Engine Configuration.
type AlertConfiguration struct {
	ID int64 `xorm:"pk autoincr 'id'"`

	AlertmanagerConfiguration string
	AlertmanagerTemplates     string
	ConfigurationVersion      string
	CreatedAt                 time.Time `xorm:"created"`
	UpdatedAt                 time.Time `xorm:"updated"`
}

// GetLatestAlertmanagerConfigurationQuery is the query to get the latest alertmanager configuration.
type GetLatestAlertmanagerConfigurationQuery struct {
	ID int64

	Result *AlertConfiguration
}
